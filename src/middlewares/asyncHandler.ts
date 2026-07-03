import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * async 라우트 핸들러에서 발생하는 에러를 Express 에러 핸들러로 전달.
 * try/catch 보일러플레이트를 제거하기 위해 사용.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
