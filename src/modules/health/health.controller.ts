import type { Request, Response } from "express";
import type { HealthResponse } from "./health.types.js";

export const getHealth = (_req: Request, res: Response): void => {
  const body: HealthResponse = {
    status: "ok",
    service: "study-tracker-api",
    timestamp: new Date().toISOString(),
  };
  res.status(200).json(body);
};
