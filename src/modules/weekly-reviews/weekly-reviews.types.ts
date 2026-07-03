import { z } from "zod";

export const WeeklyReviewUpsertSchema = z.object({
  keep: z.string(),
  problem: z.string(),
  try: z.string(),
  pledge: z.string(),
  usedBuiltinQuote: z.boolean(),
  builtinQuoteIndex: z.number().int().nullable().optional(),
});

export type WeeklyReviewUpsertInput = z.infer<typeof WeeklyReviewUpsertSchema>;

export interface WeeklyReviewResponse {
  weekStartDate: string;
  keep: string;
  problem: string;
  try: string;
  pledge: string;
  usedBuiltinQuote: boolean;
  builtinQuoteIndex: number | null;
  createdAt: string;
  updatedAt: string;
}
