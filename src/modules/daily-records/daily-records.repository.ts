import { query, getClient } from "../../lib/db.js";
import { formatLocalDate } from "../../lib/date.js";
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

export async function findByDateOwned(
  userId: string,
  date: string,
): Promise<DailyRecordResponse | null> {
  const res = await query<DailyRecordRow>(
    `SELECT * FROM daily_records WHERE user_id = $1 AND date = $2`,
    [userId, date],
  );
  if (res.rows.length === 0) return null;

  const record = res.rows[0];
  const { snapshots, snapCats, sessions } = await fetchRelated([record.id]);
  return buildRecord(record, snapshots, snapCats, sessions);
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
     ORDER BY date`,
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

    // 1) daily_record upsert
    const recRes = await client.query<DailyRecordRow>(
      `INSERT INTO daily_records (user_id, date, logic_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET updated_at = now()
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

export async function deleteSession(sessionId: string, userId: string): Promise<boolean> {
  const res = await query(
    `DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}
