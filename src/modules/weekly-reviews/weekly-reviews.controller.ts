import type { Request, Response } from "express";
import * as service from "./weekly-reviews.service.js";
import type { WeeklyReviewUpsertInput } from "./weekly-reviews.types.js";

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const review = await service.getWeeklyReview(req.user!.id, req.params["weekStartDate"] as string);
  res.json(review);
};

export const upsert = async (req: Request, res: Response): Promise<void> => {
  const review = await service.upsertWeeklyReview(
    req.user!.id,
    req.params["weekStartDate"] as string,
    req.body as WeeklyReviewUpsertInput,
  );
  res.json(review);
};
