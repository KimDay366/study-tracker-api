import { query } from "../../lib/db.js";
import * as repo from "./routine.repository.js";
import type { RoutineUpsertInput, RoutineResponse } from "./routine.types.js";

export async function getRoutine(userId: string): Promise<RoutineResponse> {
  return repo.getByUser(userId);
}

export async function upsertRoutine(
  userId: string,
  dto: RoutineUpsertInput,
): Promise<RoutineResponse> {
  // dto.days에서 null이 아닌 logicId들 추출
  const logicIds = Object.values(dto.days)
    .map((d) => d.logicId)
    .filter((id): id is string => id !== null);

  const validLogicIds = new Set<string>();

  if (logicIds.length > 0) {
    // 해당 유저 소유인 logicId만 유효
    const res = await query<{ id: string }>(
      "SELECT id FROM study_logics WHERE id = ANY($1) AND user_id = $2",
      [logicIds, userId],
    );
    for (const row of res.rows) {
      validLogicIds.add(row.id);
    }
  }

  return repo.upsert(userId, dto, validLogicIds);
}
