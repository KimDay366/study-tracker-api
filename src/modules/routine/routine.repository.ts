import { query, getClient } from "../../lib/db.js";
import type { RoutineUpsertInput, RoutineResponse } from "./routine.types.js";

interface RoutineSettingRow {
  id: string;
  user_id: string;
  updated_at: Date;
}

interface RoutineDayRow {
  id: string;
  routine_id: string;
  day_of_week: number;
  enabled: boolean;
  start_time: string | null; // pg는 TIME 컬럼을 "08:00:00" 형태 문자열로 반환
  logic_id: string | null;
}

function defaultRoutine(): RoutineResponse {
  const days: RoutineResponse["days"] = {};
  for (let i = 0; i <= 6; i++) {
    days[String(i)] = { enabled: false, time: null, logicId: null };
  }
  return { days, updatedAt: new Date().toISOString() };
}

export async function getByUser(userId: string): Promise<RoutineResponse> {
  const res = await query<RoutineSettingRow & Partial<RoutineDayRow>>(
    `SELECT rs.id, rs.user_id, rs.updated_at,
            rd.day_of_week, rd.enabled, rd.start_time, rd.logic_id
     FROM routine_settings rs
     LEFT JOIN routine_days rd ON rs.id = rd.routine_id
     WHERE rs.user_id = $1`,
    [userId],
  );

  if (res.rows.length === 0) return defaultRoutine();

  const firstRow = res.rows[0];
  const updatedAt = firstRow.updated_at.toISOString();
  const days: RoutineResponse["days"] = {};

  for (const row of res.rows) {
    if (row.day_of_week != null) {
      const key = String(row.day_of_week);
      days[key] = {
        enabled: row.enabled ?? false,
        // "08:00:00" → "08:00"
        time: row.start_time ? row.start_time.slice(0, 5) : null,
        logicId: row.logic_id ?? null,
      };
    }
  }

  // day_of_week가 없는 경우(LEFT JOIN 결과가 비어있는 경우) 기본값으로 채움
  for (let i = 0; i <= 6; i++) {
    if (!(String(i) in days)) {
      days[String(i)] = { enabled: false, time: null, logicId: null };
    }
  }

  return { days, updatedAt };
}

export async function upsert(
  userId: string,
  dto: RoutineUpsertInput,
  validLogicIds: Set<string>,
): Promise<RoutineResponse> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // 1) routine_settings upsert
    const settingRes = await client.query<RoutineSettingRow>(
      `INSERT INTO routine_settings (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING id, user_id, updated_at`,
      [userId],
    );
    const routineId = settingRes.rows[0].id;

    // 2) 각 요일 UPSERT
    for (let i = 0; i <= 6; i++) {
      const key = String(i) as keyof typeof dto.days;
      const day = dto.days[key];
      const logicId = day.logicId && validLogicIds.has(day.logicId) ? day.logicId : null;
      const startTime = day.time ?? null; // "HH:MM" or null

      await client.query(
        `INSERT INTO routine_days (routine_id, day_of_week, enabled, start_time, logic_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (routine_id, day_of_week)
         DO UPDATE SET enabled = $3, start_time = $4, logic_id = $5`,
        [routineId, i, day.enabled, startTime, logicId],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getByUser(userId);
}
