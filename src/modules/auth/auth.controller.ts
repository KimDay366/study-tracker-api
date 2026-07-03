import crypto from "node:crypto";
import type { Request, Response } from "express";
import * as service from "./auth.service.js";
import { env } from "../../lib/env.js";
import { Errors } from "../../lib/errors.js";
import { getGoogleAuthUrl } from "../../lib/google.js";

const REFRESH_COOKIE = "refreshToken";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_COOKIE = "oauthState";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // OAuth 리다이렉트 착지 후에도 전송되도록 lax (POST 엔드포인트라 CSRF 안전)
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: COOKIE_MAX_AGE_MS,
  });
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
};

// state 쿠키는 구글(cross-site)에서 콜백으로 돌아올 때 실려야 하므로 sameSite=lax
const setStateCookie = (res: Response, state: string): void => {
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  });
};

const clearStateCookie = (res: Response): void => {
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/api/v1/auth" });
};

export const signup = async (req: Request, res: Response): Promise<void> => {
  const result = await service.signup(req.body);
  res.status(201).json(result);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken, ...body } = await service.login(req.body);
  setRefreshCookie(res, refreshToken);
  res.json(body);
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) {
    res.status(401).json({ code: "AUTH_TOKEN_INVALID", message: "Refresh 토큰이 없습니다." });
    return;
  }
  const { refreshToken, ...body } = await service.refresh(token);
  setRefreshCookie(res, refreshToken);
  res.json(body);
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await service.logout(token);
  }
  clearRefreshCookie(res);
  res.json({ message: "로그아웃 되었습니다." });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  await service.verifyEmail(req.body.token as string);
  res.json({ message: "이메일 인증이 완료되었습니다." });
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  const result = await service.resendVerification(req.body.email as string);
  res.json(result);
};

// ─── 구글 OAuth (Authorization Code flow) ────────────────────────────────────

export const googleStart = async (_req: Request, res: Response): Promise<void> => {
  const state = crypto.randomBytes(16).toString("hex");
  setStateCookie(res, state);
  res.redirect(getGoogleAuthUrl(state));
};

export const googleCallback = async (req: Request, res: Response): Promise<void> => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const savedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    clearStateCookie(res);

    if (!code || !state || !savedState || state !== savedState) {
      throw Errors.AUTH_GOOGLE_FAILED();
    }

    const { refreshToken } = await service.googleLogin(code);
    setRefreshCookie(res, refreshToken);
    // 성공: 홈으로 → 프론트 AuthGuard가 refresh 쿠키로 자동 로그인
    res.redirect(`${env.CLIENT_ORIGIN}/`);
  } catch (err) {
    console.error("[googleCallback]", err);
    res.redirect(`${env.CLIENT_ORIGIN}/login?error=google`);
  }
};
