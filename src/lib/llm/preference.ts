import { PREFERENCE_ANALYSIS_PROMPT, PREFERENCE_SECTION_TEMPLATE } from "./prompts";
import { parseWithRetry } from "./parser";
import { callGemini } from "./client";
import { PreferenceAnalysisSchema, type FavoriteInput, type PreferenceAnalysis } from "./schemas";
import {
  PREFERENCE_MAX_FAVORITES_IN_PROMPT,
  PREFERENCE_FAV_TITLE_MAX_CHARS,
  PREFERENCE_FAV_TEXT_MAX_CHARS,
  PREFERENCE_LIST_MAX_ITEMS,
  PREFERENCE_ITEM_MAX_CHARS,
  PREFERENCE_GUIDANCE_MAX_CHARS,
  PREFERENCE_SUMMARY_MAX_CHARS,
  PREFERENCE_SECTION_MAX_CHARS,
  LLM_PREFERENCE_MAX_TOKENS,
  LLM_PREFERENCE_TIMEOUT_MS,
} from "../constants";

/** Sanitize text for inclusion in prompts. */
export function sanitizeForPrompt(s: string | null, maxChars: number): string {
  if (!s) return "";
  const cleaned = s
    .replace(/[\n\r\t]/g, " ")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/[{}]/g, "")
    .replace(/[<>]/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxChars);
}

/** Build favorites text block for preference analysis prompt. */
export function buildFavoritesBlock(items: FavoriteInput[]): string {
  const slice = items.slice(0, PREFERENCE_MAX_FAVORITES_IN_PROMPT);
  return slice
    .map((item, i) => {
      const label = sanitizeForPrompt(item.keywordLabel, 20);
      const scoreStr =
        item.score !== null && item.score !== undefined ? item.score.toFixed(1) : "-";
      const title = sanitizeForPrompt(item.title, PREFERENCE_FAV_TITLE_MAX_CHARS);
      const summary = sanitizeForPrompt(item.summary, PREFERENCE_FAV_TEXT_MAX_CHARS);
      const reason = sanitizeForPrompt(item.reason, PREFERENCE_FAV_TEXT_MAX_CHARS);
      return `${i + 1}. [${label}] score=${scoreStr} | ${title} | ${summary} | ${reason}`;
    })
    .join("\n");
}

/** Clamp and normalize raw parsed preference analysis payload before Zod validation. */
export function clampPreferencePayload(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return parsed;
  const obj = parsed as Record<string, unknown>;

  const clampStringArray = (arr: unknown, maxChars: number): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string")
      .slice(0, PREFERENCE_LIST_MAX_ITEMS)
      .map((s) => s.slice(0, maxChars));
  };

  return {
    themes: clampStringArray(obj.themes, PREFERENCE_ITEM_MAX_CHARS),
    traits: clampStringArray(obj.traits, PREFERENCE_ITEM_MAX_CHARS),
    dislikes: clampStringArray(obj.dislikes, PREFERENCE_ITEM_MAX_CHARS),
    scoringGuidance: clampStringArray(obj.scoringGuidance, PREFERENCE_GUIDANCE_MAX_CHARS),
    summary:
      typeof obj.summary === "string" ? obj.summary.slice(0, PREFERENCE_SUMMARY_MAX_CHARS) : "",
  };
}

/** Check if preference analysis contains actionable guidance. */
export function isUsablePreferenceAnalysis(a: PreferenceAnalysis): boolean {
  return a.themes.length + a.scoringGuidance.length > 0;
}

/** Analyze user favorite articles to extract preference profile. */
export async function analyzeFavorites(items: FavoriteInput[]): Promise<PreferenceAnalysis | null> {
  if (items.length === 0) return null;

  const prompt = PREFERENCE_ANALYSIS_PROMPT.replace("{{favoriteCount}}", () =>
    String(items.length),
  ).replace("{{favorites}}", () => buildFavoritesBlock(items));

  return parseWithRetry(
    () => callGemini(prompt, LLM_PREFERENCE_MAX_TOKENS, LLM_PREFERENCE_TIMEOUT_MS),
    PreferenceAnalysisSchema,
    "Preference analysis",
    clampPreferencePayload,
  );
}

/** Build preference prompt section from preference analysis. */
export function buildPreferencePromptSection(analysis: PreferenceAnalysis | null): string {
  if (!analysis || !isUsablePreferenceAnalysis(analysis)) return "";

  const lines: string[] = [];
  if (analysis.themes.length > 0) {
    lines.push(`- 関心テーマ: ${analysis.themes.join(" / ")}`);
  }
  if (analysis.traits.length > 0) {
    lines.push(`- 好まれる性質: ${analysis.traits.join(" / ")}`);
  }
  if (analysis.dislikes.length > 0) {
    lines.push(`- 避けられる傾向: ${analysis.dislikes.join(" / ")}`);
  }
  if (analysis.scoringGuidance.length > 0) {
    lines.push(`- 調整指針:\n  - ${analysis.scoringGuidance.join("\n  - ")}`);
  }
  if (analysis.summary) {
    lines.push(`- 傾向要約: ${analysis.summary}`);
  }

  const body = lines.join("\n");
  const section = PREFERENCE_SECTION_TEMPLATE.replace("{{body}}", () => body);
  return section.trim().slice(0, PREFERENCE_SECTION_MAX_CHARS);
}
