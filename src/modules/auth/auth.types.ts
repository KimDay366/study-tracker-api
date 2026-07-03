import { z } from "zod";

const passwordRule = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다.")
  .regex(/[a-zA-Z]/, "영문자를 포함해야 합니다.")
  .regex(/[0-9]/, "숫자를 포함해야 합니다.")
  .regex(/[^a-zA-Z0-9]/, "특수문자를 포함해야 합니다.");

export const SignupSchema = z.object({
  email: z.string().email("올바른 이메일 형식이어야 합니다."),
  password: passwordRule,
  name: z.string().min(1, "이름을 입력해주세요."),
  nickname: z
    .string()
    .min(2, "닉네임은 2자 이상이어야 합니다.")
    .max(10, "닉네임은 10자 이하여야 합니다."),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const ResendVerificationSchema = z.object({
  email: z.string().email(),
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
