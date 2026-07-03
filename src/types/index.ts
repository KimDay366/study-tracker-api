export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
}
