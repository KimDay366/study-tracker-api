import * as repo from "./settings.repository.js";
import type { SettingsPatchInput, SettingsResponse } from "./settings.types.js";

export async function getSettings(userId: string): Promise<SettingsResponse> {
  return repo.getByUser(userId);
}

export async function patchSettings(
  userId: string,
  dto: SettingsPatchInput,
): Promise<SettingsResponse> {
  return repo.patch(userId, dto);
}
