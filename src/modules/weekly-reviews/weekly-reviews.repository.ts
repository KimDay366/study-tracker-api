import { query } from "../../lib/db.js";
import { formatLocalDate } from "../../lib/date.js";
import type { WeeklyReviewUpsertInput, WeeklyReviewResponse } from "./weekly-reviews.types.js";

interface WeeklyReviewRow {
  id: string;
  user_id: string;
  week_start_date: Date;
  keep: string;
  problem: string;
  try: string;
  pledge: string;
  used_builtin_quote: boolean;
  builtin_quote_index: number | null;
  created_at: Date;
  updated_at: Date;
}

const toDateString = formatLocalDate;

function mapRow(row: WeeklyReviewRow): WeeklyReviewResponse {
  return {
    weekStartDate: toDateString(row.week_start_date),
    keep: row.keep,
    problem: row.problem,
    try: row.try,
    pledge: row.pledge,
    usedBuiltinQuote: row.used_builtin_quote,
    builtinQuoteIndex: row.builtin_quote_index,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function findByWeekOwned(
  userId: string,
  weekStartDate: string,
): Promise<WeeklyReviewResponse | null> {
  const res = await query<WeeklyReviewRow>(
    `SELECT * FROM weekly_reviews WHERE user_id = $1 AND week_start_date = $2`,
    [userId, weekStartDate],
  );
  return res.rows.length > 0 ? mapRow(res.rows[0]) : null;
}

export async function upsert(
  userId: string,
  weekStartDate: string,
  dto: WeeklyReviewUpsertInput,
): Promise<WeeklyReviewResponse> {
  const res = await query<WeeklyReviewRow>(
    `INSERT INTO weekly_reviews
       (user_id, week_start_date, keep, problem, try, pledge, used_builtin_quote, builtin_quote_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, week_start_date) DO UPDATE SET
       keep = EXCLUDED.keep,
       problem = EXCLUDED.problem,
       try = EXCLUDED.try,
       pledge = EXCLUDED.pledge,
       used_builtin_quote = EXCLUDED.used_builtin_quote,
       builtin_quote_index = EXCLUDED.builtin_quote_index,
       updated_at = now()
     RETURNING *`,
    [userId, weekStartDate, dto.keep, dto.problem, dto.try, dto.pledge, dto.usedBuiltinQuote, dto.builtinQuoteIndex ?? null],
  );
  return mapRow(res.rows[0]);
}
