// ── Scoring weights (composite score = similarity*WEIGHT_SIMILARITY + usefulness*WEIGHT_USEFULNESS + recency*WEIGHT_RECENCY) ──
export const WEIGHT_SIMILARITY = 0.2;
export const WEIGHT_USEFULNESS = 0.5;
export const WEIGHT_RECENCY = 0.3;

// ── Recency thresholds: [maxDays, score] pairs ──
// Articles newer than RECENCY_TIERS[0].days get RECENCY_TIERS[0].score, etc.
export const RECENCY_TIERS: readonly { days: number; score: number }[] = [
  { days: 1, score: 10 },
  { days: 3, score: 8 },
  { days: 7, score: 6 },
  { days: 14, score: 4 },
  { days: 30, score: 2 },
] as const;

// ── Softmax scaling ──
export const SOFTMAX_SCALE = 10;

// ── Tagging ──
export const TAGGING_THRESHOLD = 6.0;

// ── Pipeline ──
export const LLM_BATCH_SIZE = 20;
export const JAPANESE_RATIO_THRESHOLD = 0.5;
export const JAPANESE_LARGE_BATCH = 8;

// ── Embeddings ──
export const EMBEDDING_MODEL_VERSION = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;
export const MAX_CONCURRENT_EMBEDDINGS = 5;
export const EMBED_MAX_RETRIES = 3;
export const EMBED_BACKOFF_MS = 400;
export const EMBED_BATCH_SIZE = 100;

// ── API defaults ──
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const HATENA_DISCOVERY_TIMEOUT_MS = 15_000;
export const HATENA_DISCOVERY_BACKOFF_MS = 2000;
export const DEFAULT_SEARCH_LIMIT = 50;

// ── DB defaults ──
export const DEFAULT_SCORED_ARTICLES_LIMIT = 50;
export const DEFAULT_DELETE_LOW_SCORE = 5;
export const DEFAULT_ALL_ARTICLES_LIMIT = 10;

// ── LLM (Gemini) ──
export const LLM_RESPONSE_SUMMARY_MAX = 100;
export const LLM_RESPONSE_USEFULNESS_MAX = 10;
export const LLM_RESPONSE_REASON_MAX = 200;
export const LLM_SINGLE_MAX_TOKENS = 500;
export const LLM_SINGLE_TIMEOUT_MS = 30_000;
export const LLM_BATCH_MAX_TOKENS = 16000;
export const LLM_BATCH_TIMEOUT_MS = 55_000;
export const LLM_GEN_TEMPERATURE = 0.1;
export const LLM_MAX_RETRIES = 3;
export const LLM_MAX_PARSE_RETRIES = 2;
export const LLM_BACKOFF_BASE_MS = 2000;

// ── Hatena ──
export const HATENA_TIMEOUT_MS = 15_000;

// ── HTTP status codes ──
export const HTTP_STATUS_TOO_MANY_REQUESTS = 429;
export const HTTP_STATUS_SERVER_ERROR_MIN = 500;

// ── Debug / Log ──
export const DEBUG_LOG_TRUNCATE_LENGTH = 100;

// ── Time constants ──
export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
