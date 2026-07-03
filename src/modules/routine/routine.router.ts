import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { RoutineUpsertSchema } from "./routine.types.js";
import * as ctrl from "./routine.controller.js";

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(ctrl.get));
router.put("/", validate(RoutineUpsertSchema), asyncHandler(ctrl.upsert));

export default router;
