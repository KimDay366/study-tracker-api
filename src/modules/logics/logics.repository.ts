import { query, getClient } from "../../lib/db.js";
import type { LogicCreateInput, LogicUpdateInput, LogicResponse, CategoryResponse } from "./logics.types.js";

interface LogicRow {
  id: string;
  user_id: string;
  name: string;
  total_target_minutes: number;
  created_at: Date;
  updated_at: Date;
}

interface CategoryRow {
  id: string;
  logic_id: string;
  name: string;
  color_var: string;
  target_minutes: number;
  target_percent: string; // pg NUMERIC는 문자열로 반환
  sort_order: number;
}

function toCategory(row: CategoryRow): CategoryResponse {
  return {
    id: row.id,
    name: row.name,
    colorVar: row.color_var,
    targetMinutes: row.target_minutes,
    targetPercent: parseFloat(row.target_percent),
  };
}

function toLogic(row: LogicRow, categories: CategoryRow[]): LogicResponse {
  return {
    id: row.id,
    name: row.name,
    totalTargetMinutes: row.total_target_minutes,
    categories: categories.map(toCategory),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listByUser(userId: string): Promise<LogicResponse[]> {
  const logicsRes = await query<LogicRow>(
    "SELECT * FROM study_logics WHERE user_id = $1 ORDER BY created_at ASC",
    [userId],
  );
  if (logicsRes.rows.length === 0) return [];

  const logicIds = logicsRes.rows.map((r) => r.id);
  const catsRes = await query<CategoryRow>(
    "SELECT * FROM categories WHERE logic_id = ANY($1) ORDER BY sort_order ASC",
    [logicIds],
  );

  const catMap = new Map<string, CategoryRow[]>();
  for (const cat of catsRes.rows) {
    const arr = catMap.get(cat.logic_id) ?? [];
    arr.push(cat);
    catMap.set(cat.logic_id, arr);
  }

  return logicsRes.rows.map((logic) => toLogic(logic, catMap.get(logic.id) ?? []));
}

export async function findByIdOwned(id: string, userId: string): Promise<LogicResponse | null> {
  const logicRes = await query<LogicRow>(
    "SELECT * FROM study_logics WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (logicRes.rows.length === 0) return null;

  const catsRes = await query<CategoryRow>(
    "SELECT * FROM categories WHERE logic_id = $1 ORDER BY sort_order ASC",
    [id],
  );
  return toLogic(logicRes.rows[0], catsRes.rows);
}

export async function countByUser(userId: string): Promise<number> {
  const res = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM study_logics WHERE user_id = $1",
    [userId],
  );
  return parseInt(res.rows[0].count, 10);
}

export async function insertWithCategories(
  userId: string,
  dto: LogicCreateInput,
): Promise<LogicResponse> {
  const client = await getClient();
  let logicId: string;
  try {
    await client.query("BEGIN");

    const logicRes = await client.query<LogicRow>(
      "INSERT INTO study_logics (user_id, name, total_target_minutes) VALUES ($1, $2, $3) RETURNING *",
      [userId, dto.name, dto.totalTargetMinutes],
    );
    logicId = logicRes.rows[0].id;

    for (let i = 0; i < dto.categories.length; i++) {
      const cat = dto.categories[i];
      await client.query(
        "INSERT INTO categories (logic_id, user_id, name, color_var, target_minutes, target_percent, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [logicId, userId, cat.name, cat.colorVar, cat.targetMinutes, cat.targetPercent, i],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // 방금 INSERT한 직후이므로 null 불가
  return findByIdOwned(logicId, userId) as Promise<LogicResponse>;
}

export async function updateWithCategories(
  id: string,
  userId: string,
  dto: LogicUpdateInput,
): Promise<LogicResponse> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // 1) logic 업데이트
    await client.query(
      "UPDATE study_logics SET name = $1, total_target_minutes = $2 WHERE id = $3 AND user_id = $4",
      [dto.name, dto.totalTargetMinutes, id, userId],
    );

    // 2) 기존 카테고리 id 목록 조회
    const existingRes = await client.query<{ id: string }>(
      "SELECT id FROM categories WHERE logic_id = $1",
      [id],
    );
    const existingIds = new Set(existingRes.rows.map((r) => r.id));

    // 3) dto에 id가 있는 것: UPDATE, 없는 것: INSERT
    const dtoIds = new Set<string>();
    for (let i = 0; i < dto.categories.length; i++) {
      const cat = dto.categories[i];
      if (cat.id && existingIds.has(cat.id)) {
        // UPDATE
        await client.query(
          "UPDATE categories SET name = $1, color_var = $2, target_minutes = $3, target_percent = $4, sort_order = $5 WHERE id = $6",
          [cat.name, cat.colorVar, cat.targetMinutes, cat.targetPercent, i, cat.id],
        );
        dtoIds.add(cat.id);
      } else {
        // INSERT
        await client.query(
          "INSERT INTO categories (logic_id, user_id, name, color_var, target_minutes, target_percent, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [id, userId, cat.name, cat.colorVar, cat.targetMinutes, cat.targetPercent, i],
        );
      }
    }

    // 4) 기존에 있었지만 dto에 없는 것 → DELETE
    for (const existingId of existingIds) {
      if (!dtoIds.has(existingId)) {
        await client.query("DELETE FROM categories WHERE id = $1", [existingId]);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return findByIdOwned(id, userId) as Promise<LogicResponse>;
}

export async function deleteOwned(id: string, userId: string): Promise<boolean> {
  const res = await query(
    "DELETE FROM study_logics WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
