import { Errors } from "../../lib/errors.js";
import { isValidCalendarDate } from "../../lib/date.js";
import * as repo from "./daily-records.repository.js";
import type {
  SessionCreateInput,
  SessionUpdateInput,
  DailyRecordResponse,
  SessionResponse,
} from "./daily-records.types.js";

function assertValidDate(date: string): void {
  if (!isValidCalendarDate(date)) throw Errors.INVALID_DATE_FORMAT();
}

export async function getDailyRecord(
  userId: string,
  date: string,
): Promise<DailyRecordResponse> {
  assertValidDate(date);
  const record = await repo.findByDateOwned(userId, date);
  if (!record) throw Errors.DAILY_RECORD_NOT_FOUND();
  return record;
}

export async function listDailyRecords(
  userId: string,
  year: number,
  month: number,
): Promise<DailyRecordResponse[]> {
  return repo.listByMonth(userId, year, month);
}

export async function addSession(
  userId: string,
  date: string,
  body: SessionCreateInput,
): Promise<{ session: SessionResponse; isNew: boolean }> {
  assertValidDate(date);
  return repo.upsertRecordAndAddSession(userId, date, body, body.logicId, body.logicSnapshot);
}

export async function updateSession(
  userId: string,
  sessionId: string,
  dto: SessionUpdateInput,
): Promise<SessionResponse> {
  const session = await repo.updateSession(sessionId, userId, dto);
  if (!session) throw Errors.SESSION_NOT_FOUND();
  return session;
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const deleted = await repo.deleteSession(sessionId, userId);
  if (!deleted) throw Errors.SESSION_NOT_FOUND();
}
