import { z } from "zod";

export const SettingsPatchSchema = z
  .object({
    autoStartOnCategorySelect: z.boolean().optional(),
    lastUsedLogicId: z.string().uuid().nullable().optional(),
    hasSeenOnboarding: z.boolean().optional(),
    firstLaunchDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();

export type SettingsPatchInput = z.infer<typeof SettingsPatchSchema>;

export interface SettingsResponse {
  autoStartOnCategorySelect: boolean;
  lastUsedLogicId: string | null;
  dataFormatVersion: string;
  firstLaunchDate: string | null;
  hasSeenOnboarding: boolean;
  updatedAt: string;
}
