import { env } from "./env.js";

export interface Mailer {
  sendVerificationEmail(to: string, token: string): Promise<void>;
  sendPasswordReset(to: string, token: string): Promise<void>;
}

/** 테스트/로컬 개발용 — 콘솔에 토큰 출력, 마지막 토큰 메모리 보관 */
export class MockMailer implements Mailer {
  lastVerificationToken: string | null = null;
  lastResetToken: string | null = null;

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    this.lastVerificationToken = token;
    console.info(`[mailer:mock] 이메일 인증 링크 → ${to}`);
    console.info(`[mailer:mock] 토큰: ${token}`);
    console.info(`[mailer:mock] 링크: http://localhost:5173/verify-email?token=${token}`);
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    this.lastResetToken = token;
    console.info(`[mailer:mock] 비밀번호 재설정 링크 → ${to}`);
    console.info(`[mailer:mock] 토큰: ${token}`);
    console.info(`[mailer:mock] 링크: http://localhost:5173/reset-password?token=${token}`);
  }
}

/** Resend 실구현 — RESEND_API_KEY 있을 때만 사용 (현재 stub) */
class ResendMailer implements Mailer {
  async sendVerificationEmail(to: string, token: string): Promise<void> {
    // TODO: Resend SDK 구현 (S2에서 완성)
    console.info(`[mailer:resend] stub — sendVerificationEmail to=${to} token=${token}`);
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    // TODO: Resend SDK 구현 (S2에서 완성)
    console.info(`[mailer:resend] stub — sendPasswordReset to=${to} token=${token}`);
  }
}

/** 싱글톤 인스턴스 — 테스트에서 교체 가능하도록 let으로 선언 */
export let mailer: Mailer = env.RESEND_API_KEY
  ? new ResendMailer()
  : new MockMailer();

/** 테스트에서 mock mailer로 교체하기 위한 헬퍼 */
export const setMailer = (m: Mailer): void => {
  mailer = m;
};
