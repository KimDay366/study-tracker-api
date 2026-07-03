import { OAuth2Client } from "google-auth-library";
import { env } from "./env.js";

const client = new OAuth2Client({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
});

export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** 구글 동의 화면 URL 생성 (state는 CSRF 방지용) */
export const getGoogleAuthUrl = (state: string): string =>
  client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: "select_account",
  });

/** authorization code → 토큰 교환 후 id_token 검증 → 프로필 반환 */
export const verifyGoogleCode = async (code: string): Promise<GoogleProfile> => {
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("구글 id_token을 받지 못했습니다.");

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("구글 프로필 정보가 부족합니다.");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split("@")[0],
    emailVerified: payload.email_verified ?? false,
  };
};
