import { query, getClient } from "../../lib/db.js";
import { formatLocalDate } from "../../lib/date.js";
import { Errors } from "../../lib/errors.js";
import type {
  SessionCreateInput,
  SessionUpdateInput,
  LogicSnapshotInput,
  DailyRecordResponse,
  SessionResponse,
  LogicSnapshotResponse,
  AchievementCacheResponse,
} from "./daily-records.types.js";

// ─── DB row 타입 ────────────────────────────────────────────────────────────

interface DailyRecordRow {
  id: string;
  user_id: string;
  date: Date;
  logic_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface LogicSnapshotRow {
  id: string;
  daily_record_id: string;
  logic_name: string;
  total_target_minutes: number;
}

interface SnapCatRow {
  id: string;
  snapshot_id: string;
  category_id: string;
  name: string;
  color_var: string;
  target_minutes: number;
  target_percent: number;
  sort_order: number;
}

interface SessionRow {
  id: string;
  daily_record_id: string;
  user_id: string;
  category_id: string;
  session_start_ts: string; // pg BIGINT → string
  session_end_ts: string;
  duration_minutes: number;
  is_manually_edited: boolean;
  edited_at: Date | null;
  source: string;
  created_at: Date;
}

// ─── 매핑 헬퍼 ──────────────────────────────────────────────────────────────

const toDateString = formatLocalDate;

function mapSession(row: SessionRow): SessionResponse {
  return {
    id: row.id,
    categoryId: row.category_id,
    sessionStartTimestamp: Number(row.session_start_ts),
    sessionEndTimestamp: Number(row.session_end_ts),
    durationMinutes: row.duration_minutes,
    isManuallyEdited: row.is_manually_edited,
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
    source: row.source as "timer" | "manual",
  };
}

function mapSnapshot(snap: LogicSnapshotRow, cats: SnapCatRow[]): LogicSnapshotResponse {
  const sorted = [...cats].sort((a, b) => a.sort_order - b.sort_order);
  return {
    name: snap.logic_name,
    totalTargetMinutes: snap.total_target_minutes,
    categories: sorted.map((c) => ({
      id: c.category_id,
      name: c.name,
      colorVar: c.color_var,
      targetMinutes: c.target_minutes,
      targetPercent: Number(c.target_percent),
    })),
  };
}

function calcAchievementCache(
  sessions: SessionRow[],
  snapshotCategories: SnapCatRow[],
  totalTargetMinutes: number,
): AchievementCacheResponse | null {
  if (sessions.length === 0) return null;

  const catMinutes = new Map<string, number>();
  for (const s of sessions) {
    catMinutes.set(s.category_id, (catMinutes.get(s.category_id) ?? 0) + s.duration_minutes);
  }

  const totalActual = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalAchievementPercent =
    totalTargetMinutes > 0
      ? Math.round((totalActual / totalTargetMinutes) * 1000) / 10
      : 0;

  const categoryAchievements = snapshotCategories.map((cat) => ({
    categoryId: cat.category_id,
    achievementPercent:
      cat.target_minutes > 0
        ? Math.round(((catMinutes.get(cat.category_id) ?? 0) / cat.target_minutes) * 1000) / 10
        : 0,
  }));

  return { totalAchievementPercent, categoryAchievements, cachedAt: new Date().toISOString() };
}

// ─── 공통 조회 헬퍼 ─────────────────────────────────────────────────────────
// daily_record id 배열로 snapshot + categories + sessions를 한 번에 가져옴

interface SnapJoinRow {
  snapshot_id: string;
  daily_record_id: string;
  logic_name: string;
  total_target_minutes: number;
  sc_id: string | null;
  category_id: string | null;
  name: string | null;
  color_var: string | null;
  target_minutes: number | null;
  target_percent: number | null;
  sort_order: number | null;
}

async function fetchRelated(recordIds: string[]): Promise<{
  snapshots: Map<string, LogicSnapshotRow>;
  snapCats: Map<string, SnapCatRow[]>;
  sessions: Map<string, SessionRow[]>;
}> {
  const [snapRes, sessRes] = await Promise.all([
    query<SnapJoinRow>(
      `SELECT ls.id AS snapshot_id, ls.daily_record_id, ls.logic_name, ls.total_target_minutes,
              sc.id AS sc_id, sc.category_id, sc.name, sc.color_var,
              sc.target_minutes, sc.target_percent, sc.sort_order
       FROM logic_snapshots ls
       LEFT JOIN snapshot_categories sc ON sc.snapshot_id = ls.id
       WHERE ls.daily_record_id = ANY($1::uuid[])`,
      [recordIds],
    ),
    query<SessionRow>(
      `SELECT * FROM sessions WHERE daily_record_id = ANY($1::uuid[]) ORDER BY session_start_ts`,
      [recordIds],
    ),
  ]);

  const snapshots = new Map<string, LogicSnapshotRow>();
  const snapCats = new Map<string, SnapCatRow[]>();

  for (const row of snapRes.rows) {
    if (!snapshots.has(row.daily_record_id)) {
      snapshots.set(row.daily_record_id, {
        id: row.snapshot_id,
        daily_record_id: row.daily_record_id,
        logic_name: row.logic_name,
        total_target_minutes: row.total_target_minutes,
      });
    }
    if (row.category_id != null && row.sc_id != null) {
      const snap = snapshots.get(row.daily_record_id)!;
      const list = snapCats.get(snap.id) ?? [];
      list.push({
        id: row.sc_id,
        snapshot_id: snap.id,
        category_id: row.category_id,
        name: row.name!,
        color_var: row.color_var!,
        target_minutes: row.target_minutes!,
        target_percent: row.target_percent!,
        sort_order: row.sort_order!,
      });
      snapCats.set(snap.id, list);
    }
  }

  const sessions = new Map<string, SessionRow[]>();
  for (const row of sessRes.rows) {
    const list = sessions.get(row.daily_record_id) ?? [];
    list.push(row);
    sessions.set(row.daily_record_id, list);
  }

  return { snapshots, snapCats, sessions };
}

function buildRecord(
  record: DailyRecordRow,
  snapshots: Map<string, LogicSnapshotRow>,
  snapCats: Map<string, SnapCatRow[]>,
  sessions: Map<string, SessionRow[]>,
): DailyRecordResponse {
  const snap = snapshots.get(record.id);
  const cats = snap ? (snapCats.get(snap.id) ?? []) : [];
  const sess = sessions.get(record.id) ?? [];

  return {
    date: toDateString(record.date),
    logicId: record.logic_id,
    logicSnapshot: snap
      ? mapSnapshot(snap, cats)
      : { name: "", totalTargetMinutes: 0, categories: [] },
    sessions: sess.map(mapSession),
    achievementCache: snap ? calcAchievementCache(sess, cats, snap.total_target_minutes) : null,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function findGroupsByDate(
  userId: string,
  date: string,
): Promise<DailyRecordResponse[]> {
  const res = await query<DailyRecordRow>(
    `SELECT * FROM daily_records
     WHERE user_id = $1 AND date = $2
       AND EXISTS (SELECT 1 FROM sessions s WHERE s.daily_record_id = daily_records.id)
     ORDER BY created_at`,
    [userId, date],
  );
  if (res.rows.length === 0) return [];

  const recordIds = res.rows.map((r) => r.id);
  const { snapshots, snapCats, sessions } = await fetchRelated(recordIds);
  return res.rows.map((r) => buildRecord(r, snapshots, snapCats, sessions));
}

export async function listByMonth(
  userId: string,
  year: number,
  month: number,
): Promise<DailyRecordResponse[]> {
  const res = await query<DailyRecordRow>(
    `SELECT * FROM daily_records
     WHERE user_id = $1
       AND date >= make_date($2, $3, 1)
       AND date < make_date($2, $3, 1) + INTERVAL '1 month'
       AND EXISTS (SELECT 1 FROM sessions s WHERE s.daily_record_id = daily_records.id)
     ORDER BY date, created_at`,
    [userId, year, month],
  );
  if (res.rows.length === 0) return [];

  const recordIds = res.rows.map((r) => r.id);
  const { snapshots, snapCats, sessions } = await fetchRelated(recordIds);
  return res.rows.map((r) => buildRecord(r, snapshots, snapCats, sessions));
}

export async function upsertRecordAndAddSession(
  userId: string,
  date: string,
  sessionData: SessionCreateInput,
  logicId?: string,
  logicSnapshot?: LogicSnapshotInput,
): Promise<{ session: SessionResponse; isNew: boolean }> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // 0) logicId 존재/소유권 사전 검증 — 다중 탭/기기에서 로직이 방금 삭제된 뒤
    //    이미 열려 있던 타이머가 옛 logicId로 세션 저장을 시도하는 경우, DB FK
    //    위반(23503)이 그대로 500으로 새어나가지 않도록 여기서 명시적으로 막는다.
    //    같은 트랜잭션 안에서 확인하므로 검증 이후 삭제와 경합할 여지가 없다.
    if (logicId) {
      const logicCheck = await client.query(
        `SELECT 1 FROM study_logics WHERE id = $1 AND user_id = $2`,
        [logicId, userId],
      );
      if (logicCheck.rows.length === 0) {
        // catch 블록에서 ROLLBACK + release를 일괄 처리하므로 여기서는 throw만 한다.
        throw Errors.LOGIC_NOT_FOUND();
      }
    }

    // 1) daily_record upsert — (user_id, date, logic_id) 조합 단위 그룹.
    //    같은 날 다른 로직으로 세션을 추가하면 별도 행(그룹)이 새로 생긴다.
    const recRes = await client.query<DailyRecordRow>(
      `INSERT INTO daily_records (user_id, date, logic_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date, logic_id) DO UPDATE SET updated_at = now()
       RETURNING *`,
      [userId, date, logicId ?? null],
    );
    const record = recRes.rows[0];

    // 2) logic_snapshot + snapshot_categories INSERT (신규 레코드이거나 아직 없는 경우)
    if (logicSnapshot) {
      const snapRes = await client.query<{ id: string }>(
        `INSERT INTO logic_snapshots (daily_record_id, logic_name, total_target_minutes)
         VALUES ($1, $2, $3)
         ON CONFLICT (daily_record_id) DO NOTHING
         RETURNING id`,
        [record.id, logicSnapshot.name, logicSnapshot.totalTargetMinutes],
      );

      if (snapRes.rows.length > 0) {
        const snapId = snapRes.rows[0].id;
        for (let i = 0; i < logicSnapshot.categories.length; i++) {
          const cat = logicSnapshot.categories[i];
          await client.query(
            `INSERT INTO snapshot_categories
               (snapshot_id, category_id, name, color_var, target_minutes, target_percent, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [snapId, cat.id, cat.name, cat.colorVar, cat.targetMinutes, cat.targetPercent, i],
          );
        }
      }
    }

    // 3) session INSERT
    const sessRes = await client.query<SessionRow>(
      `INSERT INTO sessions
         (id, daily_record_id, user_id, category_id, session_start_ts, session_end_ts,
          duration_minutes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        sessionData.id,
        record.id,
        userId,
        sessionData.categoryId,
        sessionData.sessionStartTimestamp,
        sessionData.sessionEndTimestamp,
        sessionData.durationMinutes,
        sessionData.source,
      ],
    );

    // 3.5) 빈 그룹 방어 — 세션 insert가 no-op(중복 id)이라 이 그룹에 세션이
    //      하나도 붙지 않은 경우, 방금 upsert한 빈 daily_record 행이 영구히
    //      남지 않도록 정리한다(스냅샷/카테고리는 ON DELETE CASCADE로 함께 삭제).
    //      삭제 경로(deleteSession)의 "빈 그룹 정리" 불변식을 생성 경로에도
    //      동일하게 적용 — 세션 0개 로직이 달력에 표시되던 버그의 근본 차단.
    //      정상 경로(세션이 실제 insert됨)에는 이 분기가 실행되지 않는다.
    if (sessRes.rows.length === 0) {
      const remaining = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM sessions WHERE daily_record_id = $1`,
        [record.id],
      );
      if (remaining.rows[0].count === "0") {
        await client.query(`DELETE FROM daily_records WHERE id = $1`, [record.id]);
      }
    }

    await client.query("COMMIT");
    client.release();

    // RETURNING 비어있으면 중복 → pool query로 기존 세션 반환
    if (sessRes.rows.length > 0) {
      return { session: mapSession(sessRes.rows[0]), isNew: true };
    }

    const existing = await query<SessionRow>(
      `SELECT * FROM sessions WHERE id = $1`,
      [sessionData.id],
    );
    return { session: mapSession(existing.rows[0]), isNew: false };
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    throw err;
  }
}

export async function updateSession(
  sessionId: string,
  userId: string,
  dto: SessionUpdateInput,
): Promise<SessionResponse | null> {
  // 소유권 확인
  const check = await query<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  if (check.rows.length === 0) return null;

  const current = check.rows[0];
  const categoryId =
    dto.categoryId !== undefined ? dto.categoryId : current.category_id;
  const startTs =
    dto.sessionStartTimestamp !== undefined
      ? dto.sessionStartTimestamp
      : Number(current.session_start_ts);
  const endTs =
    dto.sessionEndTimestamp !== undefined
      ? dto.sessionEndTimestamp
      : Number(current.session_end_ts);
  const durationMinutes =
    dto.durationMinutes !== undefined ? dto.durationMinutes : current.duration_minutes;
  const isManuallyEdited =
    dto.isManuallyEdited !== undefined ? dto.isManuallyEdited : current.is_manually_edited;
  const editedAt =
    dto.editedAt !== undefined
      ? dto.editedAt
      : current.edited_at
        ? current.edited_at.toISOString()
        : null;

  const res = await query<SessionRow>(
    `UPDATE sessions
     SET category_id = $1, session_start_ts = $2, session_end_ts = $3, duration_minutes = $4,
         is_manually_edited = $5, edited_at = $6
     WHERE id = $7
     RETURNING *`,
    [categoryId, startTs, endTs, durationMinutes, isManuallyEdited, editedAt, sessionId],
  );

  return mapSession(res.rows[0]);
}

// 세션이 속한 로직 그룹(daily_record)의 스냅샷 카테고리 id 목록.
// 세션이 없거나 소유자가 다르면 null, 있으면(스냅샷 카테고리가 없어도) 배열 반환.
export async function getSessionGroupCategoryIds(
  sessionId: string,
  userId: string,
): Promise<string[] | null> {
  const res = await query<{ category_id: string | null }>(
    `SELECT sc.category_id
     FROM sessions s
     LEFT JOIN logic_snapshots ls ON ls.daily_record_id = s.daily_record_id
     LEFT JOIN snapshot_categories sc ON sc.snapshot_id = ls.id
     WHERE s.id = $1 AND s.user_id = $2`,
    [sessionId, userId],
  );
  if (res.rows.length === 0) return null;
  return res.rows.map((r) => r.category_id).filter((id): id is string => id !== null);
}

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const delRes = await client.query<{ daily_record_id: string }>(
      `DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING daily_record_id`,
      [sessionId, userId],
    );
    if (delRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    const recordId = delRes.rows[0].daily_record_id;

    // 그룹(daily_record) 행에 락을 걸어, 같은 그룹에 새 세션을 추가하려는
    // upsertRecordAndAddSession 트랜잭션과의 경합을 직렬화한다.
    // (락을 먼저 잡은 쪽이 처리를 끝낼 때까지 다른 쪽은 대기했다가, 커밋된
    //  최신 세션 수를 기준으로 판단하므로 "마지막 세션 삭제"와 "새 세션 추가"가
    //  동시에 일어나도 세션이 남아있는 그룹이 잘못 삭제되는 일은 없다.)
    await client.query(`SELECT 1 FROM daily_records WHERE id = $1 FOR UPDATE`, [recordId]);

    const remaining = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sessions WHERE daily_record_id = $1`,
      [recordId],
    );
    if (remaining.rows[0].count === "0") {
      // 남은 세션이 없으면 빈 로직 그룹 정리 — logic_snapshots/snapshot_categories는
      // ON DELETE CASCADE로 함께 삭제된다.
      await client.query(`DELETE FROM daily_records WHERE id = $1`, [recordId]);
    }

    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
