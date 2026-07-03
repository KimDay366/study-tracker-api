import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";

/**
 * 전역 에러 핸들러.
 * - AppError → err.status + { code, message }
 * - 그 외 Error → 500 INTERNAL_ERROR
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.code, message: err.message });
    return;
  }

  console.error("[errorHandler]", err);

  res.status(500).json({ code: "INTERNAL_ERROR", message: "서버 오류가 발생했습니다." });
};
