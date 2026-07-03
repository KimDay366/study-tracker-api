import type { Request, Response } from "express";
import * as service from "./settings.service.js";
import type { SettingsPatchInput } from "./settings.types.js";

export const get = async (req: Request, res: Response): Promise<void> => {
  const settings = await service.getSettings(req.user!.id);
  res.json(settings);
};

export const patch = async (req: Request, res: Response): Promise<void> => {
  const settings = await service.patchSettings(req.user!.id, req.body as SettingsPatchInput);
  res.json(settings);
};
