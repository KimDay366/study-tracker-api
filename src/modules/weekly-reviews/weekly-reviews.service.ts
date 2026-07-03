import { Errors } from "../../lib/errors.js";
import { isValidCalendarDate } from "../../lib/date.js";
import * as repo from "./weekly-reviews.repository.js";
import type { WeeklyReviewUpsertInput, WeeklyReviewResponse } from "./weekly-reviews.types.js";

function assertValidDate(date: string): void {
  if (!isValidCalendarDate(date)) throw Errors.INVALID_DATE_FORMAT();
}

export async function getWeeklyReview(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyReviewResponse> {
  assertValidDate(weekStartDate);
  const review = await repo.findByWeekOwned(userId, weekStartDate);
  if (!review) throw Errors.WEEKLY_REVIEW_NOT_FOUND();
  return review;
}

export async function upsertWeeklyReview(
  userId: string,
  weekStartDate: string,
  dto: WeeklyReviewUpsertInput,
): Promise<WeeklyReviewResponse> {
  assertValidDate(weekStartDate);
  return repo.upsert(userId, weekStartDate, dto);
}
