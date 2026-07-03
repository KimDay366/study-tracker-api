import { Router } from "express";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validator.js";
import { asyncHandler } from "../../middlewares/asyncHandler.js";
import { SessionCreateSchema, SessionUpdateSchema } from "./daily-records.types.js";
import * as ctrl from "./daily-records.controller.js";

const router = Router();

router.use(authMiddleware);

router.get("/", asyncHandler(ctrl.listByMonth));
router.get("/:date", asyncHandler(ctrl.getOne));
router.post("/:date/sessions", validate(SessionCreateSchema), asyncHandler(ctrl.addSession));
router.put("/:date/sessions/:sessionId", validate(SessionUpdateSchema), asyncHandler(ctrl.updateSession));
router.delete("/:date/sessions/:sessionId", asyncHandler(ctrl.deleteSession));

export default router;
