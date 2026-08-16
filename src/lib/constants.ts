// ── Scoring weights (composite score = relevance*WEIGHT_SIMILARITY + usefulness*WEIGHT_USEFULNESS + recency*WEIGHT_RECENCY) ──
export const WEIGHT_SIMILARITY = 0.1;
export const WEIGHT_USEFULNESS = 0.6;
export const WEIGHT_RECENCY = 0.3;

// ── NTT tag: only shown when LLM-scored ntt_relevance meets this bar ──
export const NTT_TAG_RELEVANCE_THRESHOLD = 8;

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

// ── Pipeline ──
export const LLM_BATCH_SIZE = 20;
export const JAPANESE_RATIO_THRESHOLD = 0.5;
export const JAPANESE_LARGE_BATCH = 8;
export const LLM_BATCH_CONCURRENCY = 5; // 既存値 3 を 5 に変更
export const LLM_BATCH_TIMEOUT_MS = 25_000; // 既存値 55_000 を 25_000 に変更
export const LLM_BATCH_MAX_RETRIES = 1; // 新規（batch専用）
export const SCORING_BUDGET = 40; // 新規 = 並列5 × 日本語バッチ8 = 1ウェーブ
export const SCORING_DEADLINE_MS = 45_000; // 新規（maxDuration=60s に対する全体上限）
export const SCORING_MIN_SLICE_MS = 5_000; // 新規（残り時間がこれ未満なら着手しない）
export const DISPLAY_MIN_SCORE = 5; // 新規（表示下限）
export const TOMBSTONE_RETENTION_DAYS = 30; // 新規（GC 閾値）
export const SCORING_PROMPT_VERSION = 1; // 新規（プロンプト本文変更時に bump）

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
export const LLM_RESPONSE_RELEVANCE_MAX = 10;
export const LLM_RESPONSE_REASON_MAX = 200;
export const LLM_SINGLE_MAX_TOKENS = 500;
export const LLM_SINGLE_TIMEOUT_MS = 30_000;
export const LLM_BATCH_MAX_TOKENS = 16000;
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

// ── Preference profile (favorites analysis) ──
export const FAVORITE_TAP_COUNT = 5;
export const FAVORITE_TAP_TIMEOUT_MS = 4000;
export const NFM_SWIPE_COUNT = 5;
export const NFM_SWIPE_TIMEOUT_MS = 4000;
export const NFM_SWIPE_THRESHOLD_PX = 40;

export const PREFERENCE_PROFILE_VERSION = 1;
export const PREFERENCE_MIN_FAVORITES = 5;
export const PREFERENCE_MAX_FAVORITES_IN_PROMPT = 100;
export const PREFERENCE_FAV_TITLE_MAX_CHARS = 80;
export const PREFERENCE_FAV_TEXT_MAX_CHARS = 60;
export const PREFERENCE_LIST_MAX_ITEMS = 6;
export const PREFERENCE_ITEM_MAX_CHARS = 40;
export const PREFERENCE_GUIDANCE_MAX_CHARS = 80;
export const PREFERENCE_SUMMARY_MAX_CHARS = 200;
export const PREFERENCE_SECTION_MAX_CHARS = 900;
export const PREFERENCE_SCORE_ADJUST_RANGE = 2;
export const PREFERENCE_ANALYSIS_COOLDOWN_MS =
  MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND; // 1h
export const LLM_PREFERENCE_MAX_TOKENS = 2000;
export const LLM_PREFERENCE_TIMEOUT_MS = 45_000;
