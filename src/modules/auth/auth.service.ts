import crypto from "node:crypto";
import { hashPassword, verifyPassword } from "../../lib/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { mailer } from "../../lib/mailer.js";
import { verifyGoogleCode } from "../../lib/google.js";
import { Errors } from "../../lib/errors.js";
import type { SignupInput, LoginInput, AuthTokenResponse } from "./auth.types.js";
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

export const login = async (
  input: LoginInput,
): Promise<AuthTokenResponse & { refreshToken: string }> => {
  const user = await repo.findUserByEmail(input.email);
  // 유저 없어도 비번 불일치와 동일 응답 (타이밍 공격 방지를 위해 dummy verify 생략 — 로그 기록 정도로 충분)
  if (!user) throw Errors.AUTH_INVALID_CREDENTIALS();

  if (user.status === "deleted") throw Errors.AUTH_ACCOUNT_DELETED();
  if (user.status === "suspended") throw Errors.AUTH_ACCOUNT_SUSPENDED();
  if (!user.email_verified) throw Errors.AUTH_EMAIL_NOT_VERIFIED();

  if (!user.password_hash) throw Errors.AUTH_INVALID_CREDENTIALS();
  const valid = await verifyPassword(user.password_hash, input.password);
  if (!valid) throw Errors.AUTH_INVALID_CREDENTIALS();

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

  // 1) 구글 identity로 기존 유저 조회 → 2) 같은 이메일 유저에 연결 → 3) 신규 생성
  let user = null;
  const identity = await repo.findUserIdentityByProvider("google", profile.googleId);
  if (identity) {
    user = await repo.findUserById(identity.user_id);
  } else {
    const existing = await repo.findUserByEmail(profile.email);
    if (existing) {
      await repo.insertUserIdentity(existing.id, "google", profile.googleId);
      user = existing;
    } else {
      user = await repo.insertOAuthUser({
        email: profile.email,
        name: profile.name,
        nickname: deriveNickname(profile.name, profile.email),
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
  const tokenRow = await repo.findEmailVerifyTokenByHash(sha256(plainToken));
  if (!tokenRow) throw Errors.AUTH_TOKEN_INVALID();

  await repo.consumeEmailVerifyToken(tokenRow.id);
  await repo.setEmailVerified(tokenRow.user_id);
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
