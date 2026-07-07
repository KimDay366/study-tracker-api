import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { MockMailer, setMailer } from "../src/lib/mailer.js";
import { query, closePool } from "../src/lib/db.js";

// 구글 OAuth 프로필을 테스트별로 제어하기 위한 mock — 실제 구글 네트워크 호출 방지.
// vi.mock은 파일 상단으로 hoist되므로, 아래 auth.router.js import보다 뒤에 있어도
// 라우터 내부에서 참조하는 lib/google.js는 이 mock으로 치환된다.
let mockProfile = {
  googleId: "google-uid-default",
  email: "unused@example.com",
  name: "구글유저",
  emailVerified: true,
};

vi.mock("../src/lib/google.js", () => ({
  getGoogleAuthUrl: (state: string) => `https://accounts.google.com/mock?state=${state}`,
  verifyGoogleCode: async () => mockProfile,
}));

const authRouter = (await import("../src/modules/auth/auth.router.js")).default;

const mockMailer = new MockMailer();
setMailer(mockMailer);

const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use("/api/v1/auth", authRouter);
testApp.use(errorHandler);

const BASE = "/api/v1/auth";
const CLIENT_ORIGIN = "http://localhost:5173";

const signupPayload = (overrides: Record<string, unknown> = {}) => ({
  email: "victim@example.com",
  password: "Test1234!",
  name: "테스트",
  nickname: "테스터",
  ...overrides,
});

const googleCallback = (state = "s") =>
  request(testApp)
    .get(`${BASE}/google/callback?code=dummy-code&state=${state}`)
    .set("Cookie", [`oauthState=${state}`]);

beforeEach(async () => {
  await query(
    `TRUNCATE users, user_identities, refresh_tokens, email_verification_tokens
     RESTART IDENTITY CASCADE`,
  );
  mockMailer.lastVerificationToken = null;
});

afterAll(async () => {
  await closePool();
});

// ─── [Critical-1] 미인증 로컬 계정 자동 연동 차단 ───────────────────────────────

describe("GET /google/callback — Account Linking 보안 (Critical-1)", () => {
  it("이메일 미인증 로컬 계정에 동일 이메일 구글 로그인 시도 → 자동 연동 거부, /login?error=google_unverified 리다이렉트", async () => {
    // 로컬 계정 가입만 하고 인증은 완료하지 않은 채 방치 (공격 시나리오의 선행 조건)
    await request(testApp).post(`${BASE}/signup`).send(signupPayload());

    mockProfile = {
      googleId: "attacker-google-id",
      email: "victim@example.com",
      name: "공격자가 심은 이름",
      emailVerified: true,
    };

    const res = await googleCallback();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/login?error=google_unverified`);

    // 실제로 연동(identity row 생성)이 이루어지지 않았는지 확인
    const identities = await query("SELECT provider FROM user_identities WHERE provider = 'google'");
    expect(identities.rows.length).toBe(0);
  });

  it("이메일 인증 완료된 로컬 계정은 구글 로그인 시 정상 연동 → 홈 리다이렉트 + refreshToken 쿠키", async () => {
    await request(testApp).post(`${BASE}/signup`).send(signupPayload({ email: "verified@example.com" }));
    const token = mockMailer.lastVerificationToken!;
    await request(testApp).post(`${BASE}/verify-email`).send({ token });

    mockProfile = {
      googleId: "google-id-verified",
      email: "verified@example.com",
      name: "구글이름",
      emailVerified: true,
    };

    const res = await googleCallback();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/`);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("refreshToken="))).toBe(true);

    const identities = await query("SELECT provider FROM user_identities WHERE provider = 'google'");
    expect(identities.rows.length).toBe(1);
  });

  it("탈퇴한 계정에 구글 로그인 시도 → identity row를 만들지 않고 error=account_deleted로 거부 (Minor-1)", async () => {
    await request(testApp).post(`${BASE}/signup`).send(signupPayload({ email: "deleted@example.com" }));
    const token = mockMailer.lastVerificationToken!;
    await request(testApp).post(`${BASE}/verify-email`).send({ token });
    await query("UPDATE users SET status = 'deleted' WHERE email = 'deleted@example.com'");

    mockProfile = {
      googleId: "google-id-deleted",
      email: "deleted@example.com",
      name: "구글이름",
      emailVerified: true,
    };

    const res = await googleCallback();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/login?error=account_deleted`);
    const identities = await query("SELECT provider FROM user_identities WHERE provider = 'google'");
    expect(identities.rows.length).toBe(0);
  });

  it("정지된 계정에 구글 로그인 시도 → identity row를 만들지 않고 error=account_suspended로 거부 (Minor-1)", async () => {
    await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ email: "suspended@example.com" }));
    const token = mockMailer.lastVerificationToken!;
    await request(testApp).post(`${BASE}/verify-email`).send({ token });
    await query("UPDATE users SET status = 'suspended' WHERE email = 'suspended@example.com'");

    mockProfile = {
      googleId: "google-id-suspended",
      email: "suspended@example.com",
      name: "구글이름",
      emailVerified: true,
    };

    const res = await googleCallback();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/login?error=account_suspended`);
    const identities = await query("SELECT provider FROM user_identities WHERE provider = 'google'");
    expect(identities.rows.length).toBe(0);
  });

  it("state 불일치 등 일반 실패는 기존과 동일하게 error=google로 거부", async () => {
    const res = await request(testApp)
      .get(`${BASE}/google/callback?code=dummy-code&state=mismatched`)
      .set("Cookie", ["oauthState=different-state"]);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/login?error=google`);
  });
});

// ─── [Major-1] 이메일 대소문자 정규화 ────────────────────────────────────────────

describe("이메일 대소문자 정규화 (Major-1)", () => {
  it("대문자 섞인 이메일로 가입 후 소문자로 로그인해도 동일 계정으로 인증됨", async () => {
    await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ email: "MixedCase@Example.COM" }));
    const token = mockMailer.lastVerificationToken!;
    await request(testApp).post(`${BASE}/verify-email`).send({ token });

    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "mixedcase@example.com", password: "Test1234!" });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("mixedcase@example.com");
  });

  it("대소문자만 다른 이메일 중복 가입 → 409 AUTH_EMAIL_EXISTS", async () => {
    await request(testApp).post(`${BASE}/signup`).send(signupPayload({ email: "dup@example.com" }));

    const res = await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ email: "DUP@EXAMPLE.COM" }));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("AUTH_EMAIL_EXISTS");
  });

  it("구글이 내려주는 이메일 대소문자가 가입 시와 달라도 동일 계정에 연동됨 (Account Linking 우회 방지)", async () => {
    await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ email: "Linked@Example.com" }));
    const token = mockMailer.lastVerificationToken!;
    await request(testApp).post(`${BASE}/verify-email`).send({ token });

    mockProfile = {
      googleId: "google-id-case",
      email: "linked@example.com", // 구글은 소문자로 내려주는 경우
      name: "구글이름",
      emailVerified: true,
    };

    const res = await googleCallback();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${CLIENT_ORIGIN}/`);

    const identities = await query("SELECT provider FROM user_identities WHERE provider = 'google'");
    expect(identities.rows.length).toBe(1); // 별도 계정이 아닌 동일 계정에 연동됨

    const users = await query("SELECT email FROM users");
    expect(users.rows.length).toBe(1); // 신규 계정이 따로 생성되지 않음
  });
});
