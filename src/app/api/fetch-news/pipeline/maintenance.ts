import { deleteLowScoredArticles, refreshRecencyForSources } from "@/lib/db";
import { type NormalizedArticle } from "@/lib/types";

export async function cleanupOrphaned() {
  // no longer needed — keyword is LLM-generated
}

export async function refreshRecency(
  selectedSource: string,
  all: NormalizedArticle[],
  result: { errors: string[] },
) {
  if (selectedSource) {
    try {
      const fetchedUrls = all.map((a) => a.url);
      await refreshRecencyForSources([selectedSource], fetchedUrls);
    } catch (e) {
      console.error(`[fetch-news] Recency refresh failed:`, e);
      result.errors.push(`Recency refresh failed: ${e}`);
    }
  }
}

export async function cleanupLowScored(since: string) {
  await deleteLowScoredArticles(5, since);
}
