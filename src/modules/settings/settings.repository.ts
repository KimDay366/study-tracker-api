import { query } from "../../lib/db.js";
import { formatLocalDate } from "../../lib/date.js";
import type { SettingsPatchInput, SettingsResponse } from "./settings.types.js";

const DATA_FORMAT_VERSION = "1.0.0";

interface AppSettingsRow {
  id: string;
  user_id: string;
  auto_start_on_category_select: boolean;
  last_used_logic_id: string | null;
  data_format_version: string;
  first_launch_date: Date | null;
  has_seen_onboarding: boolean;
  updated_at: Date;
}

function toSettings(row: AppSettingsRow): SettingsResponse {
  return {
    autoStartOnCategorySelect: row.auto_start_on_category_select,
    lastUsedLogicId: row.last_used_logic_id ?? null,
    dataFormatVersion: row.data_format_version,
    firstLaunchDate: row.first_launch_date
      ? formatLocalDate(row.first_launch_date)
      : null,
    hasSeenOnboarding: row.has_seen_onboarding,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getByUser(userId: string): Promise<SettingsResponse> {
  const selectRes = await query<AppSettingsRow>(
    "SELECT * FROM app_settings WHERE user_id = $1",
    [userId],
  );
  if (selectRes.rows.length > 0) {
    return toSettings(selectRes.rows[0]);
  }

  // lazy insert
  const insertRes = await query<AppSettingsRow>(
    `INSERT INTO app_settings (user_id, data_format_version)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET data_format_version = EXCLUDED.data_format_version
     RETURNING *`,
    [userId, DATA_FORMAT_VERSION],
  );
  return toSettings(insertRes.rows[0]);
}

export async function patch(userId: string, dto: SettingsPatchInput): Promise<SettingsResponse> {
  // undefined가 아닌 필드만 SET 절에 포함
  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [userId];
  let idx = 2;

  const fieldMap: Record<keyof SettingsPatchInput, string> = {
    autoStartOnCategorySelect: "auto_start_on_category_select",
    lastUsedLogicId: "last_used_logic_id",
    hasSeenOnboarding: "has_seen_onboarding",
    firstLaunchDate: "first_launch_date",
  };

  for (const [key, col] of Object.entries(fieldMap) as [keyof SettingsPatchInput, string][]) {
    if (dto[key] !== undefined) {
      setClauses.push(`${col} = $${idx}`);
      values.push(dto[key]);
      idx++;
    }
  }

  // 업데이트할 필드가 없으면 그냥 조회
  if (idx === 2) {
    return getByUser(userId);
  }

  const res = await query<AppSettingsRow>(
    `UPDATE app_settings SET ${setClauses.join(", ")} WHERE user_id = $1 RETURNING *`,
    values,
  );

  // UPDATE 대상 없으면 (아직 row 없을 때) lazy insert 후 재시도
  if (res.rows.length === 0) {
    await getByUser(userId); // 생성
    const retryRes = await query<AppSettingsRow>(
      `UPDATE app_settings SET ${setClauses.join(", ")} WHERE user_id = $1 RETURNING *`,
      values,
    );
    return toSettings(retryRes.rows[0]);
  }

  return toSettings(res.rows[0]);
}
