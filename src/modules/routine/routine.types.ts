import { z } from "zod";

const DaySchema = z.object({
  enabled: z.boolean(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  logicId: z.string().uuid().nullable(),
});

export const RoutineUpsertSchema = z.object({
  days: z.object({
    "0": DaySchema,
    "1": DaySchema,
    "2": DaySchema,
    "3": DaySchema,
    "4": DaySchema,
    "5": DaySchema,
    "6": DaySchema,
  }),
});

export type RoutineUpsertInput = z.infer<typeof RoutineUpsertSchema>;

export interface RoutineResponse {
  days: Record<string, { enabled: boolean; time: string | null; logicId: string | null }>;
  updatedAt: string;
}
