import { z } from "zod";

const COLOR_VARS = [
  "--cat-color-01",
  "--cat-color-02",
  "--cat-color-03",
  "--cat-color-04",
  "--cat-color-05",
  "--cat-color-06",
  "--cat-color-07",
  "--cat-color-08",
  "--cat-color-09",
  "--cat-color-10",
  "--cat-color-11",
  "--cat-color-12",
  "--cat-color-13",
  "--cat-color-14",
  "--cat-color-15",
  "--cat-color-16",
  "--cat-color-17",
  "--cat-color-18",
  "--cat-color-19",
  "--cat-color-20",
] as const;

const CategoryInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(20),
  colorVar: z.enum(COLOR_VARS),
  targetMinutes: z.number().int().min(1).max(1440),
  targetPercent: z.number().min(0.1).max(100.0),
});

export const LogicCreateSchema = z.object({
  name: z.string().min(1).max(20),
  totalTargetMinutes: z.number().int().min(1).max(1440),
  categories: z.array(CategoryInputSchema.omit({ id: true })).min(1).max(10),
});

export const LogicUpdateSchema = z.object({
  name: z.string().min(1).max(20),
  totalTargetMinutes: z.number().int().min(1).max(1440),
  categories: z.array(CategoryInputSchema).min(1).max(10),
});

export type LogicCreateInput = z.infer<typeof LogicCreateSchema>;
export type LogicUpdateInput = z.infer<typeof LogicUpdateSchema>;

export interface CategoryResponse {
  id: string;
  name: string;
  colorVar: string;
  targetMinutes: number;
  targetPercent: number;
}

export interface LogicResponse {
  id: string;
  name: string;
  totalTargetMinutes: number;
  categories: CategoryResponse[];
  createdAt: string;
  updatedAt: string;
}
