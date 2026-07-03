import type { Request, Response } from "express";
import * as service from "./logics.service.js";
import type { LogicCreateInput, LogicUpdateInput } from "./logics.types.js";

export const list = async (req: Request, res: Response): Promise<void> => {
  const logics = await service.listLogics(req.user!.id);
  res.json(logics);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const logic = await service.createLogic(req.user!.id, req.body as LogicCreateInput);
  res.status(201).json(logic);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const logic = await service.getLogic(req.params["id"] as string, req.user!.id);
  res.json(logic);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const logic = await service.updateLogic(
    req.params["id"] as string,
    req.user!.id,
    req.body as LogicUpdateInput,
  );
  res.json(logic);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await service.deleteLogic(req.params["id"] as string, req.user!.id);
  res.sendStatus(204);
};
