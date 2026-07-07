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

export async function getDailyRecordGroups(
  userId: string,
  date: string,
): Promise<DailyRecordResponse[]> {
  assertValidDate(date);
  return repo.findGroupsByDate(userId, date);
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

  // 세션 수정(updateSession)과 대칭: categoryId가 요청에 실린 로직 스냅샷의
  // 카테고리에 실제로 존재하는지 생성 시점에도 검증한다(설계 문서 §8-4).
  const validCategoryIds = body.logicSnapshot.categories.map((c) => c.id);
  if (!validCategoryIds.includes(body.categoryId)) {
    throw Errors.SESSION_CATEGORY_INVALID();
  }

  return repo.upsertRecordAndAddSession(userId, date, body, body.logicId, body.logicSnapshot);
}

export async function updateSession(
  userId: string,
  sessionId: string,
  dto: SessionUpdateInput,
): Promise<SessionResponse> {
  if (dto.categoryId !== undefined) {
    // 다른 로직 그룹의 카테고리로 바꾸는 것을 차단 (설계 문서 §8-4 확정: 같은 그룹 내 카테고리만 허용)
    const validCategoryIds = await repo.getSessionGroupCategoryIds(sessionId, userId);
    if (validCategoryIds === null) throw Errors.SESSION_NOT_FOUND();
    if (!validCategoryIds.includes(dto.categoryId)) throw Errors.SESSION_CATEGORY_INVALID();
  }

  const session = await repo.updateSession(sessionId, userId, dto);
  if (!session) throw Errors.SESSION_NOT_FOUND();
  return session;
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const deleted = await repo.deleteSession(sessionId, userId);
  if (!deleted) throw Errors.SESSION_NOT_FOUND();
}
