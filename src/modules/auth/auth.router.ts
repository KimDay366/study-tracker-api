import { Router } from "express";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import {
  SignupSchema,
  LoginSchema,
  VerifyEmailSchema,
  ResendVerificationSchema,
} from "./auth.types.js";
import * as ctrl from "./auth.controller.js";

const router = Router();

router.post("/signup", validate(SignupSchema), asyncHandler(ctrl.signup));
router.post("/login", validate(LoginSchema), asyncHandler(ctrl.login));
router.post("/refresh", asyncHandler(ctrl.refresh));
router.post("/logout", asyncHandler(ctrl.logout));
router.post("/verify-email", validate(VerifyEmailSchema), asyncHandler(ctrl.verifyEmail));
router.post(
  "/resend-verification",
  validate(ResendVerificationSchema),
  asyncHandler(ctrl.resendVerification),
);

export default router;
