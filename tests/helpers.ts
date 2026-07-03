import { MockMailer, setMailer, mailer } from "../src/lib/mailer.js";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import authRouter from "../src/modules/auth/auth.router.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";

// 현재 mailer가 이미 MockMailer이면 재사용, 아니면 새로 주입
// → auth.test.ts가 먼저 실행된 경우 setMailer를 중복 호출하지 않음
let _mockMailer: MockMailer;
if (mailer instanceof MockMailer) {
  _mockMailer = mailer;
} else {
  _mockMailer = new MockMailer();
  setMailer(_mockMailer);
}
export const mockMailer = _mockMailer;

const authApp = express();
authApp.use(express.json());
authApp.use(cookieParser());
authApp.use("/api/v1/auth", authRouter);
authApp.use(errorHandler);

export async function createTestUser(suffix = ""): Promise<{ accessToken: string; email: string }> {
  const email = `testuser${suffix}@test.com`;
  await request(authApp).post("/api/v1/auth/signup").send({
    email,
    password: "Test1234!",
    name: "테스터",
    nickname: "테스터",
  });
  const token = mockMailer.lastVerificationToken!;
  await request(authApp).post("/api/v1/auth/verify-email").send({ token });
  const loginRes = await request(authApp).post("/api/v1/auth/login").send({
    email,
    password: "Test1234!",
  });
  return { accessToken: loginRes.body.accessToken as string, email };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
