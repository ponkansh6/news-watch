import { db } from "../index";
import { preferenceProfiles } from "../schema";
import { desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { PREFERENCE_PROFILE_VERSION } from "../../constants";
import { PreferenceAnalysisSchema, type PreferenceAnalysis } from "@/lib/llm/schemas";

export interface PreferenceProfile {
  id: number;
  version: number;
  analysis: PreferenceAnalysis;
  promptSection: string;
  favoriteCount: number;
  favoriteMaxId: number;
  notForMeCount: number;
  notForMeMaxId: number;
  model: string;
  createdAt: string;
}

/** Latest preference profile, or null when absent/invalid/old-version.
 *  Read convention: console.warn + null on any failure (never throws). */
export async function getLatestPreferenceProfile(): Promise<PreferenceProfile | null> {
  try {
    const [row] = await db
      .select()
      .from(preferenceProfiles)
      .orderBy(desc(preferenceProfiles.id))
      .limit(1);
    if (!row) return null;
    if (row.version !== PREFERENCE_PROFILE_VERSION) {
      console.warn(`[db] getLatestPreferenceProfile version mismatch (id=${row.id})`);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.analysis);
    } catch {
      console.warn(`[db] getLatestPreferenceProfile invalid JSON (id=${row.id})`);
      return null;
    }
    const checked = PreferenceAnalysisSchema.safeParse(parsed);
    if (!checked.success) {
      console.warn(`[db] getLatestPreferenceProfile analysis schema mismatch (id=${row.id})`);
      return null;
    }
    return {
      id: row.id,
      version: row.version,
      analysis: checked.data,
      promptSection: row.promptSection,
      favoriteCount: row.favoriteCount,
      favoriteMaxId: row.favoriteMaxId,
      notForMeCount: row.notForMeCount,
      notForMeMaxId: row.notForMeMaxId,
      model: row.model,
      createdAt: row.createdAt,
    };
  } catch (err) {
    console.warn(`[db] getLatestPreferenceProfile error:`, err);
    return null;
  }
}

/** Cached variant for RSC pages only (max 5 min staleness). */
export const getLatestPreferenceProfileCached = unstable_cache(
  async () => getLatestPreferenceProfile(),
  ["preference-profile"],
  { tags: ["preference-profile"], revalidate: 300 },
);
