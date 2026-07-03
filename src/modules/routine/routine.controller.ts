import type { Request, Response } from "express";
import * as service from "./routine.service.js";
import type { RoutineUpsertInput } from "./routine.types.js";

export const get = async (req: Request, res: Response): Promise<void> => {
  const routine = await service.getRoutine(req.user!.id);
  res.json(routine);
};

export const upsert = async (req: Request, res: Response): Promise<void> => {
  const routine = await service.upsertRoutine(req.user!.id, req.body as RoutineUpsertInput);
  res.json(routine);
};
