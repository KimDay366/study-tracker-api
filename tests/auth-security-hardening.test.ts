import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../src/modules/auth/auth.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { MockMailer, setMailer } from "../src/lib/mailer.js";
import { query, closePool } from "../src/lib/db.js";
import { env } from "../src/lib/env.js";

const mockMailer = new MockMailer();
setMailer(mockMailer);

const testApp = express();
testApp.use(express.json());
testApp.use(cookieParser());
testApp.use("/api/v1/auth", authRouter);
testApp.use(errorHandler);

const BASE = "/api/v1/auth";

const signupPayload = (overrides: Record<string, unknown> = {}) => ({
  email: "hardening@example.com",
  password: "Test1234!",
  name: "테스트",
  nickname: "테스터",
  ...overrides,
});

/** 가입 → 인증 완료 → 로그인까지 마친 계정의 email/password/refreshCookie 반환 */
const createVerifiedUser = async (email = "hardening@example.com") => {
  await request(testApp).post(`${BASE}/signup`).send(signupPayload({ email }));
  const token = mockMailer.lastVerificationToken!;
  await request(testApp).post(`${BASE}/verify-email`).send({ token });
  const loginRes = await request(testApp)
    .post(`${BASE}/login`)
    .send({ email, password: "Test1234!" });
  const cookies = loginRes.headers["set-cookie"] as unknown as string[];
  const refreshCookie = cookies.find((c: string) => c.startsWith("refreshToken="))!;
  return { email, password: "Test1234!", refreshCookie };
};

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

// ─── [H-1] 로그인 계정 열거 방지 ─────────────────────────────────────────────────

describe("POST /login — 계정 열거 방지 (H-1)", () => {
  it("존재하지 않는 이메일 → 401 AUTH_INVALID_CREDENTIALS", async () => {
    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "nobody@example.com", password: "WrongPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("존재하는 계정 + 틀린 비밀번호 → 존재하지 않는 이메일과 완전히 동일한 401 응답", async () => {
    await createVerifiedUser();
    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "hardening@example.com", password: "WrongPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("정지된 계정 + 틀린 비밀번호 → 401 AUTH_INVALID_CREDENTIALS (정지 여부가 노출되지 않음)", async () => {
    const { email } = await createVerifiedUser();
    await query("UPDATE users SET status = 'suspended' WHERE email = $1", [email]);

    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email, password: "WrongPass1!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("탈퇴한 계정 + 틀린 비밀번호 → 401 AUTH_INVALID_CREDENTIALS (탈퇴 여부가 노출되지 않음)", async () => {
    const { email } = await createVerifiedUser();
    await query("UPDATE users SET status = 'deleted' WHERE email = $1", [email]);

    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email, password: "WrongPass1!" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("정지된 계정 + 맞는 비밀번호 → 403 AUTH_ACCOUNT_SUSPENDED (본인에게만 상태 안내)", async () => {
    const { email, password } = await createVerifiedUser();
    await query("UPDATE users SET status = 'suspended' WHERE email = $1", [email]);

    const res = await request(testApp).post(`${BASE}/login`).send({ email, password });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_ACCOUNT_SUSPENDED");
  });

  it("탈퇴한 계정 + 맞는 비밀번호 → 403 AUTH_ACCOUNT_DELETED (본인에게만 상태 안내)", async () => {
    const { email, password } = await createVerifiedUser();
    await query("UPDATE users SET status = 'deleted' WHERE email = $1", [email]);

    const res = await request(testApp).post(`${BASE}/login`).send({ email, password });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_ACCOUNT_DELETED");
  });

  it("미인증 계정 + 맞는 비밀번호 → 403 AUTH_EMAIL_NOT_VERIFIED (기존 동작 유지)", async () => {
    await request(testApp).post(`${BASE}/signup`).send(signupPayload());
    const res = await request(testApp)
      .post(`${BASE}/login`)
      .send({ email: "hardening@example.com", password: "Test1234!" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_EMAIL_NOT_VERIFIED");
  });
});

// ─── [C-1] refresh()의 계정 상태 검증 ────────────────────────────────────────────

describe("POST /refresh — 탈퇴/정지 계정 세션 차단 (C-1)", () => {
  it("정지된 계정의 refresh 쿠키로 갱신 시도 → 403 AUTH_ACCOUNT_SUSPENDED (세션 연장 차단)", async () => {
    const { email, refreshCookie } = await createVerifiedUser();
    await query("UPDATE users SET status = 'suspended' WHERE email = $1", [email]);

    const res = await request(testApp).post(`${BASE}/refresh`).set("Cookie", refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_ACCOUNT_SUSPENDED");
  });

  it("탈퇴한 계정의 refresh 쿠키로 갱신 시도 → 403 AUTH_ACCOUNT_DELETED (세션 연장 차단)", async () => {
    const { email, refreshCookie } = await createVerifiedUser();
    await query("UPDATE users SET status = 'deleted' WHERE email = $1", [email]);

    const res = await request(testApp).post(`${BASE}/refresh`).set("Cookie", refreshCookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AUTH_ACCOUNT_DELETED");
  });

  it("정상 계정은 기존과 동일하게 갱신 성공", async () => {
    const { refreshCookie } = await createVerifiedUser();
    const res = await request(testApp).post(`${BASE}/refresh`).set("Cookie", refreshCookie);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });
});

// ─── [H-2] Rate Limiting ────────────────────────────────────────────────────────

describe("POST /login — rate limiting (H-2)", () => {
  // rate limiter는 자동화 테스트(NODE_ENV=test)에서는 skip되도록 구현되어 있다.
  // env.NODE_ENV를 요청 시점에만 잠깐 바꿔 실제 운영 코드 경로(skip 아님)를 그대로 검증한다.
  it("IP+이메일 조합 기준 한도 초과 시 429 AUTH_RATE_LIMITED", async () => {
    const original = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const email = "rate-limit-probe@example.com";
      let last;
      for (let i = 0; i < 11; i++) {
        last = await request(testApp)
          .post(`${BASE}/login`)
          .send({ email, password: "WrongPass1!" });
      }
      expect(last!.status).toBe(429);
      expect(last!.body.code).toBe("AUTH_RATE_LIMITED");
    } finally {
      env.NODE_ENV = original;
    }
  });
});

// ─── [M-1] ACCESS/REFRESH JWT 시크릿 동일값 방지 ─────────────────────────────────

describe("env — JWT 시크릿 동일값 부팅 차단 (M-1)", () => {
  const runEnvCheck = (accessSecret: string, refreshSecret: string) =>
    spawnSync(
      "npx",
      ["tsx", "-e", "import('./src/lib/env.js').then(() => console.log('ENV_OK'))"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "development",
          DATABASE_URL: "postgres://user:pass@localhost:5432/dummy",
          JWT_ACCESS_SECRET: accessSecret,
          JWT_REFRESH_SECRET: refreshSecret,
        },
        encoding: "utf-8",
      },
    );

  it("두 시크릿이 같으면 부팅 실패(exit code 1) + 에러 메시지 출력", () => {
    const same = "a".repeat(32);
    const result = runEnvCheck(same, same);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/반드시 서로 다른 값/);
  });

  it("두 시크릿이 다르면 정상 부팅", () => {
    const result = runEnvCheck("a".repeat(32), "b".repeat(32));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ENV_OK/);
  });
});
