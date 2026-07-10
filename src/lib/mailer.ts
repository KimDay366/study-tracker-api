import { Resend } from "resend";
import { env } from "./env.js";

export interface Mailer {
  sendVerificationEmail(to: string, token: string): Promise<void>;
  sendPasswordReset(to: string, token: string): Promise<void>;
}

const verifyLink = (token: string): string =>
  `${env.CLIENT_ORIGIN}/verify-email?token=${token}`;
const resetLink = (token: string): string =>
  `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;

/** 공통 이메일 레이아웃 (한국어 HTML) */
const emailLayout = (title: string, body: string, link: string, linkLabel: string): string => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
    <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
    <p style="font-size: 15px; line-height: 1.6; color: #444;">${body}</p>
    <a href="${link}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 8px; font-size: 15px;">${linkLabel}</a>
    <p style="font-size: 13px; color: #888; line-height: 1.6;">버튼이 동작하지 않으면 아래 링크를 브라우저에 붙여넣으세요:<br><a href="${link}" style="color: #4f46e5; word-break: break-all;">${link}</a></p>
    <p style="font-size: 13px; color: #888;">이 링크는 24시간 동안 유효합니다.</p>
  </div>
`;

/** 테스트/로컬 개발용 — 콘솔에 토큰 출력, 마지막 토큰 메모리 보관 */
export class MockMailer implements Mailer {
  lastVerificationToken: string | null = null;
  lastResetToken: string | null = null;

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    this.lastVerificationToken = token;
    console.info(`[mailer:mock] 이메일 인증 링크 → ${to}`);
    console.info(`[mailer:mock] 토큰: ${token}`);
    console.info(`[mailer:mock] 링크: ${verifyLink(token)}`);
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    this.lastResetToken = token;
    console.info(`[mailer:mock] 비밀번호 재설정 링크 → ${to}`);
    console.info(`[mailer:mock] 토큰: ${token}`);
    console.info(`[mailer:mock] 링크: ${resetLink(token)}`);
  }
}

/** Resend 실구현 — RESEND_API_KEY 있을 때만 사용 */
class ResendMailer implements Mailer {
  private client = new Resend(env.RESEND_API_KEY);
  private from = env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = verifyLink(token);
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: "[차곡] 이메일 인증을 완료해주세요",
      html: emailLayout(
        "이메일 인증",
        "차곡 가입을 환영합니다! 아래 버튼을 눌러 이메일 인증을 완료해주세요.",
        link,
        "이메일 인증하기",
      ),
    });
    if (error) {
      throw new Error(`Resend 이메일 인증 발송 실패: ${JSON.stringify(error)}`);
    }
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = resetLink(token);
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: "[차곡] 비밀번호 재설정 안내",
      html: emailLayout(
        "비밀번호 재설정",
        "아래 버튼을 눌러 비밀번호를 재설정하세요. 본인이 요청하지 않았다면 이 메일을 무시하세요.",
        link,
        "비밀번호 재설정하기",
      ),
    });
    if (error) {
      throw new Error(`Resend 비밀번호 재설정 발송 실패: ${JSON.stringify(error)}`);
    }
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
