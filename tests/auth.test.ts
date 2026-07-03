import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../src/modules/auth/auth.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { MockMailer, setMailer } from "../src/lib/mailer.js";
import { query, closePool } from "../src/lib/db.js";

// mock mailer — lastVerificationToken으로 테스트에서 직접 참조
const mockMailer = new MockMailer();
setMailer(mockMailer);

const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use("/api/v1/auth", authRouter);
testApp.use(errorHandler);

// 각 테스트 전 dev DB 초기화
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

// ─── 공통 헬퍼 ────────────────────────────────────────────────────────────────

const BASE = "/api/v1/auth";

const signupPayload = (overrides: Record<string, unknown> = {}) => ({
  email: "test@example.com",
  password: "Test1234!",
  name: "테스트",
  nickname: "테스터",
  ...overrides,
});

/** 가입 → 이메일 인증 토큰 반환 */
const doSignup = async (payload = signupPayload()) => {
  const res = await request(testApp).post(`${BASE}/signup`).send(payload);
  expect(res.status).toBe(201);
  return mockMailer.lastVerificationToken!;
};

/** 가입 → 인증 → 로그인 — 성공 response + Set-Cookie 반환 */
const doLoginFlow = async () => {
  const token = await doSignup();
  await request(testApp).post(`${BASE}/verify-email`).send({ token });
  const res = await request(testApp)
    .post(`${BASE}/login`)
    .send({ email: "test@example.com", password: "Test1234!" });
  expect(res.status).toBe(200);
  return res;
};

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("POST /signup", () => {
  it("정상 가입 → 201", async () => {
    const res = await request(testApp).post(`${BASE}/signup`).send(signupPayload());
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/이메일 인증/);
  });

  it("이메일 중복 → 409 AUTH_EMAIL_EXISTS", async () => {
    await request(testApp).post(`${BASE}/signup`).send(signupPayload());
    const res = await request(testApp).post(`${BASE}/signup`).send(signupPayload());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("AUTH_EMAIL_EXISTS");
  });

  it("비밀번호 규칙 위반 → 400 VALIDATION_ERROR", async () => {
    const res = await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ password: "short" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("이메일 형식 오류 → 400", async () => {
    const res = await request(testApp)
      .post(`${BASE}/signup`)
      .send(signupPayload({ email: "not-an-email" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /verify-email", () => {
  it("유효한 토큰으로 인증 → 200", async () => {
    const token = await doSignup();
    const res = await request(testApp).post(`${BASE}/verify-email`).send({ token });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/완료/);
  });

  it("잘못된 토큰 → 401 AUTH_TOKEN_INVALID", async () => {
    await doSignup();
    const res = await request(testApp)
      .post(`${BASE}/verify-email`)
      .send({ token: "wrongtoken" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_TOKEN_INVALID");
  });
});

describe("POST /login", () => {
  it("이메일 미인증 상태 로그인 → 403 AUTH_EMAIL_NOT_VERIFIED", async () => {
    await doSignup();
    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "test@example.com", password: "Test1234!" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_EMAIL_NOT_VERIFIED");
  });

  it("인증 완료 후 로그인 → 200 + accessToken + Set-Cookie(refreshToken)", async () => {
    const res = await doLoginFlow();
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe("test@example.com");
    const cookies: string[] = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("refreshToken="))).toBe(true);
  });

  it("잘못된 비밀번호 → 401 AUTH_INVALID_CREDENTIALS", async () => {
    const token = await doSignup();
    await request(testApp).post(`${BASE}/verify-email`).send({ token });
    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "test@example.com", password: "WrongPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });
});

describe("POST /refresh", () => {
  it("유효한 refresh 쿠키 → 200 + 새 accessToken + 새 refresh 쿠키", async () => {
    const loginRes = await doLoginFlow();
    const cookies = loginRes.headers["set-cookie"] as unknown as string[];
    const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="));

    const res = await request(testApp)
      .post(`${BASE}/refresh`)
      .set("Cookie", refreshCookie!);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("refresh 토큰 회전 — 이전 토큰으로 재요청 시 401 거부", async () => {
    const loginRes = await doLoginFlow();
    const cookies = loginRes.headers["set-cookie"] as unknown as string[];
    const oldRefreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="))!;

    // 1회 회전
    await request(testApp).post(`${BASE}/refresh`).set("Cookie", oldRefreshCookie);

    // 이전 토큰으로 재시도 → 거부
    const res = await request(testApp)
      .post(`${BASE}/refresh`)
      .set("Cookie", oldRefreshCookie);

    expect(res.status).toBe(401);
  });

  it("refresh 토큰 없으면 → 401", async () => {
    const res = await request(testApp).post(`${BASE}/refresh`);
    expect(res.status).toBe(401);
  });
});

describe("POST /logout", () => {
  it("로그아웃 후 refresh 쿠키로 재요청 → 401", async () => {
    const loginRes = await doLoginFlow();
    const cookies = loginRes.headers["set-cookie"] as unknown as string[];
    const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="))!;

    await request(testApp)
      .post(`${BASE}/logout`)
      .set("Cookie", refreshCookie);

    const res = await request(testApp)
      .post(`${BASE}/refresh`)
      .set("Cookie", refreshCookie);

    expect(res.status).toBe(401);
  });
});

describe("POST /resend-verification", () => {
  it("미인증 유저 → 200 + 새 토큰 발급", async () => {
    await doSignup();
    const oldToken = mockMailer.lastVerificationToken;

    const res = await request(testApp)
      .post(`${BASE}/resend-verification`)
      .send({ email: "test@example.com" });

    expect(res.status).toBe(200);
    expect(mockMailer.lastVerificationToken).not.toBe(oldToken);
    expect(mockMailer.lastVerificationToken).toBeTruthy();
  });

  it("존재하지 않는 이메일 → 200 (열거 방지)", async () => {
    const res = await request(testApp)
      .post(`${BASE}/resend-verification`)
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
  });
});
