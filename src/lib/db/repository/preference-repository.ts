import { db } from "../index";
import { preferenceProfiles } from "../schema";
import { PreferenceAnalysis } from "@/lib/llm/schemas";

export interface SavePreferenceProfileInput {
  analysis: PreferenceAnalysis;
  promptSection: string;
  favoriteCount: number;
  favoriteMaxId: number;
  model: string;
}

/** Insert a preference profile (append-only). Returns the new row id. */
export async function savePreferenceProfile(input: SavePreferenceProfileInput): Promise<number> {
  try {
    const result = await db
      .insert(preferenceProfiles)
      .values({
        analysis: JSON.stringify(input.analysis),
        promptSection: input.promptSection,
        favoriteCount: input.favoriteCount,
        favoriteMaxId: input.favoriteMaxId,
        model: input.model,
      })
      .returning({ id: preferenceProfiles.id });
    return result[0]?.id ?? 0;
  } catch (err) {
    console.error(`[db] savePreferenceProfile error:`, err);
    throw err;
  }
}
