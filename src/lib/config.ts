/** 監視キーワード一覧（固定値 -> 後々UI化） */
export const KEYWORDS = [
  "TSMC",
  "連続体仮説",
  "CERN",
  "核融合",
  "GPT-5",
] as const;

export type Keyword = (typeof KEYWORDS)[number];
