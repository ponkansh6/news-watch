/** 監視キーワード一覧（固定値 -> 後々UI化） */
export const KEYWORDS = [
  "Anthropic",
  "OpenAI",
  "Softbank",
  "KDDI",
  "NTT",
  "Google",
  "docomo",
] as const;

export type Keyword = (typeof KEYWORDS)[number];
