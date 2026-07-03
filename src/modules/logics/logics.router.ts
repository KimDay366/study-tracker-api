import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { LogicCreateSchema, LogicUpdateSchema } from "./logics.types.js";
import * as ctrl from "./logics.controller.js";

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(ctrl.list));
router.post("/", validate(LogicCreateSchema), asyncHandler(ctrl.create));
router.get("/:id", asyncHandler(ctrl.getOne));
router.put("/:id", validate(LogicUpdateSchema), asyncHandler(ctrl.update));
router.delete("/:id", asyncHandler(ctrl.remove));

export default router;
