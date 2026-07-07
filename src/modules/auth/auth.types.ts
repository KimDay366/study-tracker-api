import { z } from "zod";

const passwordRule = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다.")
  .regex(/[a-zA-Z]/, "영문자를 포함해야 합니다.")
  .regex(/[0-9]/, "숫자를 포함해야 합니다.")
  .regex(/[^a-zA-Z0-9]/, "특수문자를 포함해야 합니다.");

/**
 * 이메일 정규화 — trim + lowercase.
 * Account Linking(구글 OAuth ↔ 이메일 계정)이 대소문자 차이로 우회되지 않도록,
 * 저장·조회의 유일한 키인 이메일은 입력 경계에서 항상 정규화한다.
 * zod를 거치지 않는 경로(googleLogin의 구글 프로필 이메일)는 auth.service.ts에서 별도 적용.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// trim().toLowerCase()를 먼저 적용한 뒤 형식을 검증해야 공백·대소문자가 섞인
// 유효한 이메일이 오검출되지 않는다 (검증 순서가 체이닝 순서를 따름).
const emailField = (message?: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .email(message ?? "올바른 이메일 형식이어야 합니다.");

export const SignupSchema = z.object({
  email: emailField(),
  password: passwordRule,
  name: z.string().min(1, "이름을 입력해주세요."),
  nickname: z
    .string()
    .min(2, "닉네임은 2자 이상이어야 합니다.")
    .max(10, "닉네임은 10자 이하여야 합니다."),
});

export const LoginSchema = z.object({
  email: emailField(),
  password: z.string().min(1),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const ResendVerificationSchema = z.object({
  email: emailField(),
});

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export interface AuthTokenResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    nickname: string;
    role: string;
  };
}
