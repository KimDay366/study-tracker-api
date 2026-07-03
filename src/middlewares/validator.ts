import type { Request, Response, NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";
import type { ApiError } from "../types/index.js";

/**
 * ZodError → "field: message, field2: message2" 형식 문자열 변환.
 * validate() 미들웨어와 컨트롤러 직접 파싱 모두에서 공유한다.
 */
export function zodErrorToMessage(error: ZodError): string {
  return error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
}

/**
 * zod 스키마로 req.body를 검증하는 미들웨어 팩토리.
 * 검증 실패 시 400 + { code: "VALIDATION_ERROR", message } 반환.
 *
 * 사용 예:
 *   router.post("/", validate(MySchema), asyncHandler(myController));
 */
export const validate =
  (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const body: ApiError = {
        code: "VALIDATION_ERROR",
        message: zodErrorToMessage(result.error),
      };
      res.status(400).json(body);
      return;
    }
    req.body = result.data;
    next();
  };
