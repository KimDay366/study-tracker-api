import { z } from "zod";

const LogicSnapshotInputSchema = z.object({
  name: z.string().min(1),
  totalTargetMinutes: z.number().int().min(0),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      colorVar: z.string(),
      targetMinutes: z.number().int().min(0),
      targetPercent: z.number(),
    }),
  ),
});

export const SessionCreateSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string(),
  sessionStartTimestamp: z.number().int(),
  sessionEndTimestamp: z.number().int(),
  durationMinutes: z.number().int().min(0),
  source: z.enum(["timer", "manual"]),
  logicId: z.string().uuid(),
  logicSnapshot: LogicSnapshotInputSchema,
});

export const SessionUpdateSchema = z.object({
  categoryId: z.string().optional(),
  isManuallyEdited: z.boolean().optional(),
  editedAt: z.string().nullable().optional(),
  sessionStartTimestamp: z.number().int().optional(),
  sessionEndTimestamp: z.number().int().optional(),
  durationMinutes: z.number().int().min(0).optional(),
});

export const DailyRecordListQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030),
  month: z.coerce.number().int().min(1).max(12),
});

export type SessionCreateInput = z.infer<typeof SessionCreateSchema>;
export type SessionUpdateInput = z.infer<typeof SessionUpdateSchema>;
export type LogicSnapshotInput = z.infer<typeof LogicSnapshotInputSchema>;

export interface LogicSnapshotResponse {
  name: string;
  totalTargetMinutes: number;
  categories: {
    id: string;
    name: string;
    colorVar: string;
    targetMinutes: number;
    targetPercent: number;
  }[];
}

export interface SessionResponse {
  id: string;
  categoryId: string;
  sessionStartTimestamp: number;
  sessionEndTimestamp: number;
  durationMinutes: number;
  isManuallyEdited: boolean;
  editedAt: string | null;
  source: "timer" | "manual";
}

export interface AchievementCacheResponse {
  totalAchievementPercent: number;
  categoryAchievements: { categoryId: string; achievementPercent: number }[];
  cachedAt: string;
}

export interface DailyRecordResponse {
  date: string;
  logicId: string | null;
  logicSnapshot: LogicSnapshotResponse;
  sessions: SessionResponse[];
  achievementCache: AchievementCacheResponse | null;
  createdAt: string;
  updatedAt: string;
}
