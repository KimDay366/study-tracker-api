import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { WeeklyReviewUpsertSchema } from "./weekly-reviews.types.js";
import * as ctrl from "./weekly-reviews.controller.js";

const router = Router();

router.use(authMiddleware);

router.get("/:weekStartDate", asyncHandler(ctrl.getOne));
router.put("/:weekStartDate", validate(WeeklyReviewUpsertSchema), asyncHandler(ctrl.upsert));

export default router;
