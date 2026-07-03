import type { Request, Response } from "express";
import * as service from "./auth.service.js";

const REFRESH_COOKIE = "refreshToken";
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/v1/auth",
    maxAge: COOKIE_MAX_AGE_MS,
  });
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
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
