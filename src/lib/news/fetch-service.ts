import { getSourceAdapter, type SourceId } from "@/lib/news/registry";
import type { NormalizedArticle } from "@/lib/types";
import { getLatestPreferenceProfile, refreshRecencyForSources, upsertArticles } from "@/lib/db";
import { buildPreferencePromptSection, type IdentifiedArticleScore } from "@/lib/llm";
import {
  computeContentHash,
  computeIdentifiedScoringSignature,
  computeScoringSignature,
} from "@/lib/scoring-signature";
import { NTT_TAG_RELEVANCE_THRESHOLD, SCORING_BUDGET } from "@/lib/constants";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { calcCompositeScore, calcRecencyScore } from "@/lib/scoring";
import {
  getBatchCandidates,
  listRefreshJobCandidates,
  stageRefreshCandidates,
} from "@/lib/db/repository/refresh-candidate-repository";
import type { LLMResponse } from "@/lib/llm";
import type { GeminiLeaseEvidence } from "@/lib/db/repository/gemini-rate-limit-repository";
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
  /** Explicit API execution context for Gemini send-slot recovery. */
  geminiLeaseEvidence?: GeminiLeaseEvidence;
};

export type CollectRefreshCandidatesResult = {
  fetched: number;
  selected: number;
  deferred: number;
  signature: string;
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
        leaseEvidence: options.geminiLeaseEvidence,
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

/** Fetch and durably stage candidates for one aggregate source without scoring them. */
export async function collectRefreshCandidates(
  selectedSource: SourceId,
  jobId: string,
  executionToken: string,
  options: Pick<
    FetchSourceOptions,
    "strictAdapterErrors" | "beforeAdapterStart" | "onAdapterStart"
  > & { sourceAttemptCount: number } = { sourceAttemptCount: 0 },
): Promise<CollectRefreshCandidatesResult> {
  const adapter = getSourceAdapter(selectedSource);
  if (!adapter) throw new Error(`Unsupported source: ${selectedSource}`);
  const profile = await getLatestPreferenceProfile();
  const preferenceSection = buildPreferencePromptSection(profile?.analysis ?? null);
  const signature = computeIdentifiedScoringSignature(preferenceSection);
  if (options.beforeAdapterStart && !(await options.beforeAdapterStart())) {
    throw new AdapterStartCheckpointError();
  }
  const request = (options.strictAdapterErrors ? adapter.fetchForWorkflow : adapter.fetch)();
  const startedAt = new Date().toISOString();
  if (options.onAdapterStart) {
    let checkpointed = false;
    try {
      checkpointed = await options.onAdapterStart(startedAt);
    } catch {
      await request.catch(() => undefined);
      throw new AdapterStartCheckpointError();
    }
    if (!checkpointed) {
      await request.catch(() => undefined);
      throw new AdapterStartCheckpointError();
    }
  }

  const raw = await request;
  const articles = deduplicate(raw.map((item) => adapter.toArticle(item, adapter.id)));
  const selection = await selectForScoring(articles, signature, 50);
  await stageRefreshCandidates(
    jobId,
    executionToken,
    selectedSource,
    selection.toScore.map((article) => ({
      sourceId: selectedSource,
      contentHash: computeContentHash(article.title, article.description),
      scoringSignature: signature,
      payload: { ...article, preferenceSection },
    })),
    { resultCount: selection.toScore.length, sourceAttemptCount: options.sourceAttemptCount },
  );
  return {
    fetched: articles.length,
    selected: selection.toScore.length,
    deferred: selection.deferred.length,
    signature,
  };
}

/** Refresh existing article scores after the source checkpoint is durable. */
export async function refreshStagedSourceRecency(
  jobId: string,
  executionToken: string,
  sourceId: SourceId,
  _sourceAttemptCount: number,
): Promise<number> {
  const candidates = await listRefreshJobCandidates(jobId, executionToken);
  const selectedUrls = candidates.flatMap((candidate) => {
    const sourceIds = JSON.parse(candidate.sourceIdsJson) as string[];
    if (!sourceIds.includes(sourceId)) return [];
    const payload = JSON.parse(candidate.payloadJson) as Record<string, unknown>;
    return typeof payload.url === "string" ? [payload.url] : [];
  });
  return refreshRecencyForSources([sourceId], selectedUrls, { strict: true });
}

/** Persist a previously validated durable batch result idempotently. */
export async function persistIdentifiedCandidateBatch(
  jobId: string,
  executionToken: string,
  batchId: string,
  scores: IdentifiedArticleScore[],
): Promise<number> {
  const candidates = await getBatchCandidates(jobId, executionToken, batchId);
  if (candidates.length !== scores.length)
    throw new Error("candidate_batch_persist_count_mismatch");
  const scoreById = new Map(scores.map(({ id, score }) => [id, score]));
  const upserts = candidates.map((candidate) => {
    const payload = JSON.parse(candidate.payloadJson) as Record<string, unknown>;
    const score = scoreById.get(candidate.id) as LLMResponse | undefined;
    if (!score) throw new Error("candidate_batch_score_missing");
    const title = String(payload.title ?? "");
    const description = typeof payload.description === "string" ? payload.description : null;
    const publishedAt = String(payload.publishedAt ?? new Date().toISOString());
    const relevance = score.ntt_relevance ?? 0;
    const usefulness = score.usefulness ?? null;
    return {
      title,
      description,
      url: String(payload.url),
      urlToImage: typeof payload.urlToImage === "string" ? payload.urlToImage : null,
      publishedAt,
      sourceName: String(payload.sourceName ?? candidate.representativeSourceId),
      sourceId: candidate.representativeSourceId,
      author: typeof payload.author === "string" ? payload.author : null,
      keyword: relevance >= NTT_TAG_RELEVANCE_THRESHOLD ? "NTT" : null,
      summary: score.summary,
      relevance,
      usefulness,
      recency: calcRecencyScore(publishedAt),
      score: calcCompositeScore(relevance, usefulness, calcRecencyScore(publishedAt)),
      reason: score.reason,
      scoredAt: new Date().toISOString(),
      recencyRefreshedAt: new Date().toISOString(),
      contentHash: candidate.contentHash,
      scoringSignature: candidate.scoringSignature,
    };
  });
  const result = await upsertArticles(upserts);
  if (result.failed.length > 0 || result.succeeded.length !== upserts.length) {
    throw new Error("candidate_batch_article_persistence_failed");
  }
  return result.succeeded.length;
}
