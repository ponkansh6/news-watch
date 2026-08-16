import { z } from "zod/v4";
import {
  LLM_RESPONSE_SUMMARY_MAX,
  LLM_RESPONSE_USEFULNESS_MAX,
  LLM_RESPONSE_RELEVANCE_MAX,
  LLM_RESPONSE_TOPIC_MAX,
  LLM_RESPONSE_REASON_MAX,
  PREFERENCE_LIST_MAX_ITEMS,
  PREFERENCE_ITEM_MAX_CHARS,
  PREFERENCE_GUIDANCE_MAX_CHARS,
  PREFERENCE_SUMMARY_MAX_CHARS,
} from "../constants";

export const LLMResponseSchema = z.object({
  summary: z.string().min(1).max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  ntt_relevance: z.number().min(0).max(LLM_RESPONSE_RELEVANCE_MAX),
  topic: z.string().min(1).max(LLM_RESPONSE_TOPIC_MAX),
  reason: z.string().min(1).max(LLM_RESPONSE_REASON_MAX),
});

/** Lenient schema for batch mode — Gemini sometimes returns empty strings for
 *  summary/reason in batch responses. We accept and pad them with defaults. */
export const LLMBatchItemSchema = z.object({
  summary: z.string().max(LLM_RESPONSE_SUMMARY_MAX),
  usefulness: z.number().min(0).max(LLM_RESPONSE_USEFULNESS_MAX),
  ntt_relevance: z.number().min(0).max(LLM_RESPONSE_RELEVANCE_MAX),
  topic: z.string().max(LLM_RESPONSE_TOPIC_MAX),
  reason: z.string().max(LLM_RESPONSE_REASON_MAX),
});

export const LLMBatchResponseSchema = z.array(LLMBatchItemSchema);

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface ArticleInput {
  title: string;
  description: string | null;
}

export const PreferenceAnalysisSchema = z.object({
  themes: z.array(z.string().min(1).max(PREFERENCE_ITEM_MAX_CHARS)).max(PREFERENCE_LIST_MAX_ITEMS),
  traits: z.array(z.string().min(1).max(PREFERENCE_ITEM_MAX_CHARS)).max(PREFERENCE_LIST_MAX_ITEMS),
  dislikes: z
    .array(z.string().min(1).max(PREFERENCE_ITEM_MAX_CHARS))
    .max(PREFERENCE_LIST_MAX_ITEMS),
  scoringGuidance: z
    .array(z.string().min(1).max(PREFERENCE_GUIDANCE_MAX_CHARS))
    .max(PREFERENCE_LIST_MAX_ITEMS),
  summary: z.string().max(PREFERENCE_SUMMARY_MAX_CHARS),
});
export type PreferenceAnalysis = z.infer<typeof PreferenceAnalysisSchema>;

export interface FavoriteInput {
  title: string;
  summary: string | null;
  keywordLabel: string | null;
  reason: string | null;
  score: number | null;
}
