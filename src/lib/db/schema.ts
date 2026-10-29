import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { PREFERENCE_PROFILE_VERSION } from "../constants";

/**
 * Scored news articles.
 * - url is unique for deduplication (auto-indexed by UNIQUE).
 * - Query pattern: WHERE score IS NOT NULL ORDER BY score DESC, publishedAt DESC.
 * - getAllArticles queries: ORDER BY createdAt DESC.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url").notNull().unique(),
    urlToImage: text("url_to_image"),
    publishedAt: text("published_at").notNull(),
    sourceName: text("source_name"),
    sourceId: text("source_id"),
    author: text("author"),
    keyword: text("keyword"),
    summary: text("summary"),
    relevance: real("relevance"),
    usefulness: real("usefulness"),
    recency: real("recency"),
    recencyRefreshedAt: text("recency_refreshed_at"),
    reason: text("reason"),
    scoredAt: text("scored_at"),
    score: real("score"),
    contentHash: text("content_hash"), // 記事の title + description のハッシュ
    scoringSignature: text("scoring_signature"), // プロンプト版 + モデル + 嗜好セクションのハッシュ
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    keywordIdx: index("idx_keyword").on(table.keyword),
    sourceScorePubIdx: index("idx_source_score_pub").on(
      table.sourceId,
      table.score,
      table.publishedAt,
    ),
    createdAtIdx: index("idx_created_at").on(table.createdAt),
  }),
);

/**
 * Hidden favorites (unofficial feature).
 * - article_id is unique (one favorite per article, toggle on/off).
 * - No visitor ID — shared global list for a limited group of users.
 * - Trigger: 5 rapid clicks on the reason (AI evaluation comment) span.
 */
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueArticle: uniqueIndex("favorites_article_id_unique").on(table.articleId),
  }),
);

/**
 * Not For Me (hidden/disliked articles).
 * - article_id is unique (one not-for-me per article, toggle on/off).
 * - Trigger: タイトルの5連続横スワイプ
 */
export const notForMe = sqliteTable(
  "not_for_me",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    uniqueArticle: uniqueIndex("not_for_me_article_id_unique").on(table.articleId),
  }),
);

/**
 * User preference profiles extracted from favorites by LLM (append-only history).
 * - active profile = latest by id (created_at is ISO string with second tie).
 * - analysis stores the validated JSON (PreferenceAnalysis); prompt_section is
 *   an audit snapshot of the generated prompt text (rebuilt on read).
 */
export const preferenceProfiles = sqliteTable("preference_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: integer("version").notNull().default(PREFERENCE_PROFILE_VERSION),
  analysis: text("analysis").notNull(),
  promptSection: text("prompt_section").notNull(),
  favoriteCount: integer("favorite_count").notNull(),
  favoriteMaxId: integer("favorite_max_id").notNull().default(0),
  notForMeCount: integer("not_for_me_count").notNull().default(0),
  notForMeMaxId: integer("not_for_me_max_id").notNull().default(0),
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Shared singleton claim used to serialize single-source and aggregate refreshes. */
export const refreshJobSlot = sqliteTable("refresh_job_slot", {
  id: integer("id").primaryKey(),
  ownerKind: text("owner_kind", { enum: ["single", "job"] }),
  ownerId: text("owner_id"),
  ownerTokenHash: text("owner_token_hash"),
  acquiredAt: text("acquired_at"),
  leaseKind: text("lease_kind"),
  deploymentId: text("deployment_id"),
  recoveryAfter: text("recovery_after"),
});

/** Durable aggregate/single refresh job metadata. Tokens are stored hashed. */
export const refreshJobs = sqliteTable(
  "refresh_jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    ownerTokenHash: text("owner_token_hash").notNull(),
    sourceIds: text("source_ids").notNull(),
    status: text("status", {
      enum: [
        "enqueue_unknown",
        "queued",
        "running",
        "completed",
        "partial",
        "failed",
        "needs_reconciliation",
      ],
    })
      .notNull()
      .default("queued"),
    workflowRunId: text("workflow_run_id").unique(),
    currentSourceId: text("current_source_id"),
    revision: integer("revision").notNull().default(0),
    nextEligibleAt: text("next_eligible_at"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusIndex: index("idx_refresh_jobs_status_updated").on(table.status, table.updatedAt),
  }),
);

/** Per-source durable checkpoint; no article content is stored in Workflow state. */
export const refreshJobSources = sqliteTable(
  "refresh_job_sources",
  {
    jobId: text("job_id")
      .notNull()
      .references(() => refreshJobs.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    status: text("status", {
      enum: ["pending", "executing", "saved", "invalidated", "failed", "unknown"],
    })
      .notNull()
      .default("pending"),
    adapterStartedAt: text("adapter_started_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    savedAt: text("saved_at"),
    cacheInvalidatedAt: text("cache_invalidated_at"),
    completedAt: text("completed_at"),
    resultCount: integer("result_count"),
    errorCode: text("error_code"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: uniqueIndex("refresh_job_sources_job_source_unique").on(table.jobId, table.sourceId),
    orderIndex: index("idx_refresh_job_sources_order").on(table.jobId, table.ordinal),
  }),
);

/** Article candidates retained between aggregate Workflow steps. */
export const refreshJobCandidates = sqliteTable(
  "refresh_job_candidates",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => refreshJobs.id, { onDelete: "cascade" }),
    normalizedUrl: text("normalized_url").notNull(),
    payloadJson: text("payload_json").notNull(),
    contentHash: text("content_hash").notNull(),
    scoringSignature: text("scoring_signature").notNull(),
    representativeSourceId: text("representative_source_id").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    ordinal: integer("ordinal").notNull(),
    status: text("status", { enum: ["pending", "batched", "saved", "failed"] })
      .notNull()
      .default("pending"),
    batchId: text("batch_id"),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    jobUrl: uniqueIndex("refresh_job_candidates_job_url_unique").on(
      table.jobId,
      table.normalizedUrl,
    ),
    jobState: index("idx_refresh_job_candidates_job_state_order").on(
      table.jobId,
      table.status,
      table.ordinal,
    ),
    batch: index("idx_refresh_job_candidates_batch").on(table.batchId),
  }),
);

/** Immutable candidate membership for a durable aggregate scoring step. */
export const refreshJobBatches = sqliteTable(
  "refresh_job_batches",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => refreshJobs.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    candidateIdsJson: text("candidate_ids_json").notNull(),
    scoringSignature: text("scoring_signature").notNull(),
    status: text("status", {
      enum: ["pending", "running", "result_ready", "saved", "failed", "unknown"],
    })
      .notNull()
      .default("pending"),
    resultJson: text("result_json"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => ({
    jobOrdinal: uniqueIndex("refresh_job_batches_job_ordinal_unique").on(
      table.jobId,
      table.ordinal,
    ),
    jobState: index("idx_refresh_job_batches_job_state_order").on(
      table.jobId,
      table.status,
      table.ordinal,
    ),
  }),
);

/** Shared send lock held across one Gemini HTTP attempt. */
export const geminiRequestSlot = sqliteTable("gemini_request_slot", {
  id: integer("id").primaryKey(),
  ownerId: text("owner_id"),
  ownerTokenHash: text("owner_token_hash"),
  acquiredAt: text("acquired_at"),
  leaseKind: text("lease_kind"),
  deploymentId: text("deployment_id"),
  recoveryAfter: text("recovery_after"),
});

/** Durable accounting for every Gemini HTTP attempt, including ambiguous sends. */
export const geminiRequestAttempts = sqliteTable(
  "gemini_request_attempts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    outcome: text("outcome", { enum: ["started", "succeeded", "failed", "ambiguous"] })
      .notNull()
      .default("started"),
  },
  (table) => ({
    completedAtIndex: index("idx_gemini_request_attempts_completed_at").on(table.completedAt),
    owner: index("idx_gemini_request_attempts_owner").on(table.ownerId),
  }),
);
