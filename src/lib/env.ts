import "dotenv/config";
import { z } from "zod";

/**
 * 환경변수 스키마.
 * S1(인증/DB): DATABASE_URL, JWT 시크릿 필수화.
 * Resend, Google OAuth, Supabase 키는 로컬 개발 시 빈 값 허용 — 부팅 실패하지 않음.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),

  // PostgreSQL 연결 — S1부터 필수
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 설정되어야 합니다"),

  // Supabase — 로컬 개발 미사용, 배포 시 채움
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Resend — 로컬은 mock 어댑터 사용 예정, 빈 값 허용
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  // Google OAuth — 로컬 개발 단계 미사용, 빈 값 허용
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),

  // JWT — S1부터 필수
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET은 32자 이상이어야 합니다"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET은 32자 이상이어야 합니다"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("7d"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] 환경변수 파싱 실패:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// 선택적 외부 서비스 키 누락 경고 (빈 값이어도 부팅 가능)
const warnKeys = ["RESEND_API_KEY", "GOOGLE_OAUTH_CLIENT_ID"] as const;
const warnMissing = warnKeys.filter((k) => !parsed.data[k]);
if (warnMissing.length > 0 && parsed.data.NODE_ENV !== "test") {
  console.warn("[env] 외부 서비스 키 미설정 (로컬 개발 시 무방):", warnMissing.join(", "));
}

export const env = parsed.data;
