import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { env } from "../lib/env.js";
import { Errors } from "../lib/errors.js";

/**
 * IP + 요청 바디의 email(있으면 소문자 정규화)을 조합한 키.
 * email이 없는 엔드포인트(verify-email, google/callback)는 IP만으로 제한한다.
 * ipKeyGenerator는 IPv6 주소를 서브넷 단위로 정규화해 사소한 IP 변형으로
 * 제한을 우회하지 못하도록 한다.
 */
const ipAndEmailKey = (req: Request): string => {
  const ip = ipKeyGenerator(req.ip ?? "unknown");
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  return email ? `${ip}:${email}` : ip;
};

/**
 * 인증 관련 민감 엔드포인트용 rate limiter 팩토리.
 *
 * Why: 자동화 테스트(vitest)는 항상 같은 IP(127.0.0.1)에서 파일당 수십 건의 요청을
 * 짧은 시간에 반복하므로, 프로덕션과 동일한 제한을 걸면 테스트가 rate limit에
 * 걸려 실패한다. env.NODE_ENV==='test'(vitest가 자동 설정)에서는 비활성화한다.
 */
const createAuthLimiter = (windowMs: number, max: number) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndEmailKey,
    skip: () => env.NODE_ENV === "test",
    handler: (_req, res) => {
      const err = Errors.AUTH_RATE_LIMITED();
      res.status(err.status).json({ code: err.code, message: err.message });
    },
  });

/** 로그인 — 무차별 대입(크리덴셜 스터핑) 방어. IP+이메일 조합 기준 1분 10회. */
export const loginLimiter = createAuthLimiter(60 * 1000, 10);

/** 회원가입 — 대량 계정 생성/스팸 가입 방어. IP+이메일 조합 기준 1분 10회. */
export const signupLimiter = createAuthLimiter(60 * 1000, 10);

/** 인증 메일 재발송 — 이메일 폭탄(스팸) 방어. IP+이메일 조합 기준 10분 5회. */
export const resendVerificationLimiter = createAuthLimiter(10 * 60 * 1000, 5);

/** 이메일 인증 — 토큰 대입 방어(심층 방어용). IP 기준 1분 20회. */
export const verifyEmailLimiter = createAuthLimiter(60 * 1000, 20);

/** 구글 OAuth 콜백 — 무의미한 반복 호출 방어. IP 기준 1분 20회. */
export const googleCallbackLimiter = createAuthLimiter(60 * 1000, 20);
