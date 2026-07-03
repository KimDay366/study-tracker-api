import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../lib/jwt.js";
import { Errors } from "../lib/errors.js";

/**
 * Authorization: Bearer <token> 파싱 → req.user 주입.
 * 실패 시 AppError throw (asyncHandler 또는 직접 next(err) 전달).
 */
export const authMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(Errors.AUTH_UNAUTHORIZED());
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(Errors.AUTH_TOKEN_EXPIRED());
    } else {
      next(Errors.AUTH_TOKEN_INVALID());
    }
  }
};
