export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  AUTH_EMAIL_EXISTS: () =>
    new AppError("AUTH_EMAIL_EXISTS", 409, "이미 사용 중인 이메일입니다."),
  AUTH_INVALID_CREDENTIALS: () =>
    new AppError("AUTH_INVALID_CREDENTIALS", 401, "이메일 또는 비밀번호가 올바르지 않습니다."),
  AUTH_EMAIL_NOT_VERIFIED: () =>
    new AppError("AUTH_EMAIL_NOT_VERIFIED", 403, "이메일 인증이 완료되지 않았습니다."),
  AUTH_ACCOUNT_SUSPENDED: () =>
    new AppError("AUTH_ACCOUNT_SUSPENDED", 403, "정지된 계정입니다."),
  AUTH_ACCOUNT_DELETED: () =>
    new AppError("AUTH_ACCOUNT_DELETED", 403, "탈퇴한 계정입니다."),
  AUTH_TOKEN_INVALID: () =>
    new AppError("AUTH_TOKEN_INVALID", 401, "유효하지 않은 토큰입니다."),
  AUTH_TOKEN_EXPIRED: () =>
    new AppError("AUTH_TOKEN_EXPIRED", 401, "만료된 토큰입니다."),
  AUTH_UNAUTHORIZED: () =>
    new AppError("AUTH_UNAUTHORIZED", 401, "인증이 필요합니다."),
  AUTH_GOOGLE_FAILED: () =>
    new AppError("AUTH_GOOGLE_FAILED", 401, "구글 인증에 실패했습니다."),
  NOT_FOUND: (resource = "리소스") =>
    new AppError("NOT_FOUND", 404, `${resource}를 찾을 수 없습니다.`),
  LOGIC_NOT_FOUND: () =>
    new AppError("LOGIC_NOT_FOUND", 404, "로직을 찾을 수 없습니다."),
  LOGIC_LIMIT_EXCEEDED: () =>
    new AppError("LOGIC_LIMIT_EXCEEDED", 409, "로직은 최대 5개까지 생성할 수 있습니다."),
  CATEGORY_LIMIT_EXCEEDED: () =>
    new AppError("CATEGORY_LIMIT_EXCEEDED", 409, "카테고리는 최대 10개까지 추가할 수 있습니다."),
  INVALID_COLOR_VAR: () =>
    new AppError("INVALID_COLOR_VAR", 400, "유효하지 않은 컬러 변수입니다."),
  DAILY_RECORD_NOT_FOUND: () =>
    new AppError("DAILY_RECORD_NOT_FOUND", 404, "일일 기록을 찾을 수 없습니다."),
  SESSION_NOT_FOUND: () =>
    new AppError("SESSION_NOT_FOUND", 404, "세션을 찾을 수 없습니다."),
  WEEKLY_REVIEW_NOT_FOUND: () =>
    new AppError("WEEKLY_REVIEW_NOT_FOUND", 404, "주간 회고를 찾을 수 없습니다."),
  INVALID_DATE_FORMAT: () =>
    new AppError("INVALID_DATE_FORMAT", 400, "날짜 형식이 올바르지 않습니다. YYYY-MM-DD를 사용하세요."),
} as const;
