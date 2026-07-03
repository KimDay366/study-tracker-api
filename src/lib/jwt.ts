import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "./env.js";

export interface AccessTokenPayload {
  sub: string;
  role: string;
}

export interface RefreshTokenPayload {
  sub: string;
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] });

export const signRefreshToken = (payload: RefreshTokenPayload): string =>
  // jti(JWT ID)로 랜덤값 포함 — 동일 유저·동일 초에 연속 발급해도 고유한 토큰 보장
  jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString("hex") },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.REFRESH_TOKEN_TTL as jwt.SignOptions["expiresIn"] },
  );

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof decoded === "string") throw new Error("invalid token");
  return decoded as AccessTokenPayload;
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (typeof decoded === "string") throw new Error("invalid token");
  return decoded as RefreshTokenPayload;
};
