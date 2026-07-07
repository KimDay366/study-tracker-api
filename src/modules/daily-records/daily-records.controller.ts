import type { Request, Response } from "express";
import * as service from "./daily-records.service.js";
import { zodErrorToMessage } from "../../middlewares/validator.js";
import {
  DailyRecordListQuerySchema,
  type SessionCreateInput,
  type SessionUpdateInput,
} from "./daily-records.types.js";

export const getGroupsByDate = async (req: Request, res: Response): Promise<void> => {
  const groups = await service.getDailyRecordGroups(req.user!.id, req.params["date"] as string);
  res.json(groups);
};

export const listByMonth = async (req: Request, res: Response): Promise<void> => {
  const parsed = DailyRecordListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ code: "VALIDATION_ERROR", message: zodErrorToMessage(parsed.error) });
    return;
  }
  const records = await service.listDailyRecords(req.user!.id, parsed.data.year, parsed.data.month);
  res.json(records);
};

export const addSession = async (req: Request, res: Response): Promise<void> => {
  const { session, isNew } = await service.addSession(
    req.user!.id,
    req.params["date"] as string,
    req.body as SessionCreateInput,
  );
  res.status(isNew ? 201 : 200).json(session);
};

export const updateSession = async (req: Request, res: Response): Promise<void> => {
  const session = await service.updateSession(
    req.user!.id,
    req.params["sessionId"] as string,
    req.body as SessionUpdateInput,
  );
  res.json(session);
};

export const deleteSession = async (req: Request, res: Response): Promise<void> => {
  await service.deleteSession(req.user!.id, req.params["sessionId"] as string);
  res.status(204).send();
};
