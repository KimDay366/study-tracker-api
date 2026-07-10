import crypto from "node:crypto";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "../../lib/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { mailer } from "../../lib/mailer.js";
import { verifyGoogleCode } from "../../lib/google.js";
import { Errors } from "../../lib/errors.js";
import type { SignupInput, LoginInput, AuthTokenResponse } from "./auth.types.js";
import { normalizeEmail } from "./auth.types.js";
import * as repo from "./auth.repository.js";

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────

const sha256 = (plain: string): string =>
  crypto.createHash("sha256").update(plain).digest("hex");

const randomHex = (bytes = 32): string => crypto.randomBytes(bytes).toString("hex");

const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Service ──────────────────────────────────────────────────────────────────

export const signup = async (
  input: SignupInput,
): Promise<{ message: string }> => {
  const existing = await repo.findUserByEmail(input.email);
  if (existing) throw Errors.AUTH_EMAIL_EXISTS();

  const passwordHash = await hashPassword(input.password);
  const user = await repo.insertUser({
    email: input.email,
    name: input.name,
    nickname: input.nickname,
    passwordHash,
  });

  // 이메일 인증 토큰 — 평문 발송, DB엔 SHA-256 해시
  const plainToken = randomHex(32);
  await repo.insertEmailVerifyToken({
    userId: user.id,
    tokenHash: sha256(plainToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  // 메일 발송은 best-effort — 실패해도 가입은 유지, 사용자는 재발송으로 대응
  try {
    await mailer.sendVerificationEmail(user.email, plainToken);
  } catch (err) {
    console.error(`[signup] 인증 메일 발송 실패 (가입은 유지) → ${user.email}`, err);
  }

  return { message: "가입이 완료되었습니다. 이메일 인증 후 로그인할 수 있습니다." };
};

/**
 * 이메일 사용 가능 여부(중복 아님) 확인 — 가입 폼 실시간 검사용.
 * 이메일은 DB에서 UNIQUE이며, 여기서도 대소문자 정규화된 값으로 조회한다.
 * 참고: 가입 시점에도 AUTH_EMAIL_EXISTS로 최종 검증하므로 이 결과는 UX 사전 안내용이다.
 */
export const isEmailAvailable = async (email: string): Promise<boolean> => {
  const existing = await repo.findUserByEmail(email);
  return !existing;
};

export const login = async (
  input: LoginInput,
): Promise<AuthTokenResponse & { refreshToken: string }> => {
  const user = await repo.findUserByEmail(input.email);

  // 비밀번호 검증을 항상 먼저, 무조건 실행한다 (계정 존재/상태 분기보다 앞에 둔다).
  // 계정이 없거나 비밀번호가 없는 계정(OAuth 전용)이어도 더미 해시로 argon2.verify를
  // 실행해 응답시간을 상수화한다 — 그래야 "계정이 없어서 빠르게 끝남" vs
  // "비밀번호가 달라서 argon2 검증까지 돌고 실패함" 사이의 타이밍 차이가 사라진다.
  const hashToVerify = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const passwordValid = await verifyPassword(hashToVerify, input.password);

  // 계정이 없거나 비밀번호가 틀리면 상태(가입 여부/탈퇴/정지/미인증)와 무관하게
  // 완전히 동일한 응답을 반환한다 — 계정 열거(enumeration) 차단이 목적.
  if (!user || !passwordValid) {
    throw Errors.AUTH_INVALID_CREDENTIALS();
  }

  // 비밀번호를 아는 "본인"에게만 계정 상태를 안내한다 (열거 위험 없음).
  if (!user.email_verified) throw Errors.AUTH_EMAIL_NOT_VERIFIED();
  if (user.status === "suspended") throw Errors.AUTH_ACCOUNT_SUSPENDED();
  if (user.status === "deleted") throw Errors.AUTH_ACCOUNT_DELETED();

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  await repo.insertRefreshToken({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
  };
};

/** OAuth 닉네임 기본값 — 구글 이름 또는 이메일 로컬파트, 최대 20자 */
const deriveNickname = (name: string, email: string): string =>
  (name || email.split("@")[0] || "user").trim().slice(0, 20) || "user";

export const googleLogin = async (
  code: string,
): Promise<AuthTokenResponse & { refreshToken: string }> => {
  const profile = await verifyGoogleCode(code);
  // 구글 프로필 이메일은 zod 검증 경로를 거치지 않으므로 여기서 직접 정규화
  const email = normalizeEmail(profile.email);

  // 1) 구글 identity로 기존 유저 조회 → 2) 같은 이메일 유저에 연결 → 3) 신규 생성
  let user = null;
  const identity = await repo.findUserIdentityByProvider("google", profile.googleId);
  if (identity) {
    user = await repo.findUserById(identity.user_id);
  } else {
    const existing = await repo.findUserByEmail(email);
    if (existing) {
      // 탈퇴/정지 계정은 identity row조차 만들지 않는다 (데이터 위생)
      if (existing.status === "deleted") throw Errors.AUTH_ACCOUNT_DELETED();
      if (existing.status === "suspended") throw Errors.AUTH_ACCOUNT_SUSPENDED();

      // Account Linking은 로컬(이메일+비밀번호) 계정의 이메일 인증 완료 후에만 허용.
      // (docs/commercialization-qa.md A-03/A-04, RISK-05)
      // 미검증 상태에서 자동 연동을 허용하면, 공격자가 피해자 이메일로 먼저
      // 가입해 인증을 방치해둔 뒤 피해자의 구글 로그인이 그 계정에 흡수되어
      // 공격자가 입력한 프로필로 오염된 계정이 피해자에게 연결되는 계정 탈취가 가능하다.
      if (existing.password_hash && !existing.email_verified) {
        throw Errors.AUTH_GOOGLE_LINK_UNVERIFIED();
      }

      await repo.insertUserIdentity(existing.id, "google", profile.googleId);
      user = existing;
    } else {
      user = await repo.insertOAuthUser({
        email,
        name: profile.name,
        nickname: deriveNickname(profile.name, email),
        provider: "google",
        providerUserId: profile.googleId,
      });
    }
  }

  if (!user) throw Errors.AUTH_GOOGLE_FAILED();
  if (user.status === "deleted") throw Errors.AUTH_ACCOUNT_DELETED();
  if (user.status === "suspended") throw Errors.AUTH_ACCOUNT_SUSPENDED();

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  await repo.insertRefreshToken({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
  });

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
  };
};

export const refresh = async (
  refreshToken: string,
): Promise<AuthTokenResponse & { refreshToken: string }> => {
  // 1) JWT 서명 검증
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Errors.AUTH_TOKEN_INVALID();
  }

  // 2) DB에서 유효한 토큰 확인
  const stored = await repo.findValidRefreshTokenByHash(sha256(refreshToken));
  if (!stored) throw Errors.AUTH_TOKEN_INVALID();

  // 3) 토큰 회전 — 기존 revoke + 신규 발급
  await repo.revokeRefreshToken(sha256(refreshToken));

  const user = await repo.findUserById(payload.sub);
  if (!user) throw Errors.AUTH_TOKEN_INVALID();

  // login()/googleLogin()과 동일한 계정 상태 검증.
  // 이게 없으면 이미 브라우저에 남아있는 refresh 쿠키로 탈퇴/정지 이후에도
  // 회전을 반복하며 세션을 무기한 유지할 수 있다(로그인 화면에서만 막히고
  // 이미 로그인된 세션에는 정지/탈퇴가 전혀 적용되지 않는 문제).
  // 주의: 이 시점에는 위에서 이미 기존 토큰을 revoke했으므로, 여기서 거부돼도
  // 방금 사용된 refresh 토큰은 재사용 불가 상태로 남는다 (안전한 편).
  if (user.status === "deleted") throw Errors.AUTH_ACCOUNT_DELETED();
  if (user.status === "suspended") throw Errors.AUTH_ACCOUNT_SUSPENDED();

  const newAccessToken = signAccessToken({ sub: user.id, role: user.role });
  const newRefreshToken = signRefreshToken({ sub: user.id });

  await repo.insertRefreshToken({
    userId: user.id,
    tokenHash: sha256(newRefreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MS),
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
  };
};

export const logout = async (refreshToken: string): Promise<void> => {
  await repo.revokeRefreshToken(sha256(refreshToken));
};

export const verifyEmail = async (plainToken: string): Promise<void> => {
  const tokenHash = sha256(plainToken);

  // 정상 경로: 아직 소비되지 않고 만료 전인 토큰 → 인증 처리
  const tokenRow = await repo.findEmailVerifyTokenByHash(tokenHash);
  if (tokenRow) {
    await repo.consumeEmailVerifyToken(tokenRow.id);
    await repo.setEmailVerified(tokenRow.user_id);
    return;
  }

  // 멱등 처리: 이미 소비된 토큰이라도 해당 유저가 이미 인증 완료 상태면 성공으로 응답한다.
  // 인증 링크 중복 클릭·새로고침, 메일 클라이언트의 링크 프리페치, SPA 이펙트 중복 실행 등으로
  // 같은 토큰이 두 번 POST되면 첫 요청이 인증을 끝내고 둘째 요청이 AUTH_TOKEN_INVALID로 실패해
  // "실제로는 인증됐는데 화면엔 실패"로 보이는 문제를 막는다.
  const consumed = await repo.findEmailVerifyTokenByHashAny(tokenHash);
  if (consumed) {
    const user = await repo.findUserById(consumed.user_id);
    if (user?.email_verified) return; // 이미 인증 완료 → 멱등 성공
  }

  // 존재하지 않거나 만료됐는데 아직 미인증 → 실제 실패(재발송 유도)
  throw Errors.AUTH_TOKEN_INVALID();
};

export const resendVerification = async (email: string): Promise<{ message: string }> => {
  const user = await repo.findUserByEmail(email);
  // 유저 없어도 성공처럼 응답 (이메일 열거 방지)
  if (!user || user.email_verified) {
    return { message: "인증 메일을 전송했습니다." };
  }

  // 기존 토큰 정리 후 재발급
  await repo.deleteEmailVerifyTokensByUserId(user.id);

  const plainToken = randomHex(32);
  await repo.insertEmailVerifyToken({
    userId: user.id,
    tokenHash: sha256(plainToken),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  // best-effort — 실패해도 열거 방지 위해 동일 응답, 실패는 로그로만
  try {
    await mailer.sendVerificationEmail(user.email, plainToken);
  } catch (err) {
    console.error(`[resendVerification] 인증 메일 재발송 실패 → ${user.email}`, err);
  }
  return { message: "인증 메일을 전송했습니다." };
};
