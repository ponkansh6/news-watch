/** 監視キーワード一覧（固定値 -> 後々UI化） */
export const KEYWORDS = [
  "Anthropic Claude AI safety enterprise AI",
  "GPT5 チャットGPT Codex",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー",
  "KDDI au 通信キャリア UQモバイル",
  "NTT 日本電信電話 NTTデータ NTTドコモ",
  "Gemini 3 Flash Pro Antigravity TPU",
  "docomo ドコモ NTTドコモ モバイル通信 キャリア",
  "Copilot GitHub Microsoft WorkIQ",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

/** KEYWORDS 配列の各キーワードに対するUI表示名 */
export const KEYWORD_LABELS: Record<string, string> = {
  "Anthropic Claude AI safety enterprise AI": "Anthropic",
  "GPT5 チャットGPT Codex": "GPT",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー": "Softbank",
  "KDDI au 通信キャリア UQモバイル": "KDDI",
  "NTT 日本電信電話 NTTデータ NTTドコモ": "NTT",
  "Gemini 3 Flash Pro Antigravity TPU": "Gemini",
  "docomo ドコモ NTTドコモ モバイル通信 キャリア": "docomo",
  "Copilot GitHub Microsoft WorkIQ": "Copilot",
};
