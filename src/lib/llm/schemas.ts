import { z } from "zod/v4";
import {
  LLM_RESPONSE_SUMMARY_MAX,
  LLM_RESPONSE_USEFULNESS_MAX,
  LLM_RESPONSE_REASON_MAX,
} from "../constants";

export const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  reason: z.string().min(1).max(LLM_RESPONSE_REASON_MAX),
});

/** Lenient schema for batch mode — Gemini sometimes returns empty strings for
 *  summary/reason in batch responses. We accept and pad them with defaults. */
export const LLMBatchItemSchema = z.object({
  summary: z.string().max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  reason: z.string().max(LLM_RESPONSE_REASON_MAX),
});

export const LLMBatchResponseSchema = z.array(LLMBatchItemSchema);

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface ArticleInput {
  title: string;
  description: string | null;
}
