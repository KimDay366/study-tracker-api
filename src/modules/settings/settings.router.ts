import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { SettingsPatchSchema } from "./settings.types.js";
import * as ctrl from "./settings.controller.js";

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(ctrl.get));
router.patch("/", validate(SettingsPatchSchema), asyncHandler(ctrl.patch));

export default router;
