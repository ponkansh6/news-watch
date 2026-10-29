import { getSourceAdapter, type SourceId } from "@/lib/news/registry";
import type { NormalizedArticle } from "@/lib/types";
import { getLatestPreferenceProfile } from "@/lib/db";
import { buildPreferencePromptSection } from "@/lib/llm";
import { computeScoringSignature } from "@/lib/scoring-signature";
import { SCORING_BUDGET } from "@/lib/constants";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import {
  cleanupOrphaned,
  refreshRecency,
  gcStaleArticles,
} from "@/app/api/fetch-news/pipeline/maintenance";
import { selectForScoring } from "@/app/api/fetch-news/pipeline/select";

export type FetchProgress = {
  stage: "fetching" | "selecting" | "scoring" | "cleanup" | "complete";
  completed: number;
  total: number;
  failed: number;
};

export type SourceFetchResult = {
  keyword: "latest";
  fetched: number;
  candidates: number;
  saved: number | undefined;
  scored: number;
  skipped: number;
  deferred: number;
  errors: string[];
  scoringErrors: string[];
};

export type SourceFetchResponse = {
  ok: true;
  message: "Scoring queued";
  results: SourceFetchResult[];
  perSource: { source: SourceId; fetched: number }[];
};

export type FetchSourceOptions = {
  /** Use adapters that preserve source-scoped HTTP/network/timeout/parse errors. */
  strictAdapterErrors?: boolean;
  /** Verify durable ownership and eligibility immediately before invoking the adapter. */
  beforeAdapterStart?: () => Promise<boolean>;
  /** Called immediately after starting the adapter request, before awaiting it. */
  onAdapterStart?: (startedAt: string) => Promise<boolean>;
};

export class AdapterStartCheckpointError extends Error {
  constructor() {
    super("Could not persist the source adapter start checkpoint");
    this.name = "AdapterStartCheckpointError";
  }
}

function deduplicate(articles: NormalizedArticle[]): NormalizedArticle[] {
  const seen = new Set<string>();
  return articles.filter((article) => {
    try {
      const key = new URL(article.url).href.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      if (seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    }
  });
}

/** Fetch, select, score, and persist one source without invalidating the article cache. */
export async function fetchSource(
  selectedSource: SourceId,
  onProgress?: (progress: FetchProgress) => void,
  options: FetchSourceOptions = {},
): Promise<SourceFetchResponse> {
  await cleanupOrphaned();
  onProgress?.({ stage: "fetching", completed: 0, total: 0, failed: 0 });
  const adapter = getSourceAdapter(selectedSource);
  if (!adapter) throw new Error(`Unsupported source: ${selectedSource}`);

  const profile = await getLatestPreferenceProfile();
  const preferenceSection = buildPreferencePromptSection(profile?.analysis ?? null);
  const signature = computeScoringSignature(preferenceSection);

  if (options.beforeAdapterStart && !(await options.beforeAdapterStart())) {
    throw new AdapterStartCheckpointError();
  }
  const adapterRequest = (options.strictAdapterErrors ? adapter.fetchForWorkflow : adapter.fetch)();
  const adapterStartedAt = new Date().toISOString();
  if (options.onAdapterStart) {
    let checkpointed = false;
    try {
      checkpointed = await options.onAdapterStart(adapterStartedAt);
    } catch {
      await adapterRequest.catch(() => undefined);
      throw new AdapterStartCheckpointError();
    }
    if (!checkpointed) {
      await adapterRequest.catch(() => undefined);
      throw new AdapterStartCheckpointError();
    }
  }
  const raw = await adapterRequest;
  const all = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id)));
  const perSource = [{ source: adapter.id as SourceId, fetched: raw.length }];

  onProgress?.({ stage: "selecting", completed: 0, total: 0, failed: 0 });
  const selection = await selectForScoring(all, signature, SCORING_BUDGET);
  const result: SourceFetchResult = {
    keyword: "latest",
    fetched: all.length,
    candidates: all.length,
    saved: undefined,
    scored: selection.toScore.length,
    skipped: selection.skipped.length,
    deferred: selection.deferred.length,
    errors: [],
    scoringErrors: [],
  };

  await refreshRecency(
    selectedSource,
    selection.toScore.map((article) => article.url),
    result,
  );

  let completedScoring = 0;
  let failedScoring = 0;
  if (selection.toScore.length > 0) {
    let scoringFailed = false;
    let scoredCount = 0;
    onProgress?.({ stage: "scoring", completed: 0, total: selection.toScore.length, failed: 0 });
    try {
      result.saved = await scoreAndSaveTagged(selection.toScore, {
        preferenceSection,
        signature,
        onScoringError: () => {
          scoringFailed = true;
        },
        onScoringSuccess: () => {
          scoredCount++;
        },
        onScoringProgress: (completed, failed, total) => {
          completedScoring = completed;
          failedScoring = failed;
          onProgress?.({ stage: "scoring", completed, failed, total });
        },
      });
    } catch (scoringError) {
      console.error("[fetch-news] Scoring failed:", scoringError);
      scoringFailed = true;
    }

    if (scoringFailed && scoredCount === 0) {
      const message = "採点サービスでエラーが発生しました。時間をおいて再試行してください。";
      result.scoringErrors.push(message);
      result.errors.push(`Scoring failed: ${message}`);
    }
  }

  onProgress?.({
    stage: "cleanup",
    completed: completedScoring,
    total: selection.toScore.length,
    failed: failedScoring,
  });
  await gcStaleArticles();
  const response: SourceFetchResponse = {
    ok: true,
    message: "Scoring queued",
    results: [result],
    perSource,
  };
  onProgress?.({
    stage: "complete",
    completed: completedScoring,
    total: selection.toScore.length,
    failed: failedScoring,
  });
  return response;
}
