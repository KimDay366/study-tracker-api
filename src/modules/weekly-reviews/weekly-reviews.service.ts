import { Errors } from "../../lib/errors.js";
import { isValidCalendarDate, addDaysToDateStr, kstTodayStr } from "../../lib/date.js";
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

  // 등록·수정 가능 기간 검증 (모바일/클라이언트 우회 방지 — 서버가 최종 판정).
  // weekStartDate는 그 주 '월요일'. 기준일은 그 주 '일요일'(월+6),
  // 창은 [일요일 00:00, 일요일+30일 23:59:59] KST. 날짜 문자열 비교로 판정한다.
  const weekSunday = addDaysToDateStr(weekStartDate, 6);
  const deadline = addDaysToDateStr(weekSunday, 30);
  const today = kstTodayStr();
  if (today < weekSunday) throw Errors.WEEKLY_REVIEW_NOT_OPEN();
  if (today > deadline) throw Errors.WEEKLY_REVIEW_WINDOW_CLOSED();

  return repo.upsert(userId, weekStartDate, dto);
}
