import { Router } from "express";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import {
  loginLimiter,
  signupLimiter,
  resendVerificationLimiter,
  verifyEmailLimiter,
  googleCallbackLimiter,
  checkEmailLimiter,
} from "../../middlewares/rateLimiter.js";
import {
  SignupSchema,
  LoginSchema,
  VerifyEmailSchema,
  ResendVerificationSchema,
  CheckEmailSchema,
} from "./auth.types.js";
import * as ctrl from "./auth.controller.js";

const router = Router();

router.post("/signup", signupLimiter, validate(SignupSchema), asyncHandler(ctrl.signup));
router.post(
  "/check-email",
  checkEmailLimiter,
  validate(CheckEmailSchema),
  asyncHandler(ctrl.checkEmail),
);
router.post("/login", loginLimiter, validate(LoginSchema), asyncHandler(ctrl.login));
router.post("/refresh", asyncHandler(ctrl.refresh));
router.post("/logout", asyncHandler(ctrl.logout));
router.post(
  "/verify-email",
  verifyEmailLimiter,
  validate(VerifyEmailSchema),
  asyncHandler(ctrl.verifyEmail),
);
router.post(
  "/resend-verification",
  resendVerificationLimiter,
  validate(ResendVerificationSchema),
  asyncHandler(ctrl.resendVerification),
);

// 구글 OAuth (리다이렉트 방식)
router.get("/google", asyncHandler(ctrl.googleStart));
router.get("/google/callback", googleCallbackLimiter, asyncHandler(ctrl.googleCallback));

export default router;
