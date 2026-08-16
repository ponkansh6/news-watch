import { deleteStaleLowScored, refreshRecencyForSources } from "@/lib/db";
import { DISPLAY_MIN_SCORE, TOMBSTONE_RETENTION_DAYS } from "@/lib/constants";

export async function cleanupOrphaned() {
  // no longer needed — keyword is LLM-generated
}

export async function refreshRecency(
  selectedSource: string,
  fetchedUrls: string[],
  result: { errors: string[] },
) {
  if (selectedSource) {
    try {
      await refreshRecencyForSources([selectedSource], fetchedUrls);
    } catch (e) {
      console.error(`[fetch-news] Recency refresh failed:`, e);
      result.errors.push(`Recency refresh failed: ${e}`);
    }
  }
}

export async function gcStaleArticles() {
  try {
    await deleteStaleLowScored(DISPLAY_MIN_SCORE, TOMBSTONE_RETENTION_DAYS);
  } catch (e) {
    console.error(`[fetch-news] GC stale articles failed:`, e);
  }
}
