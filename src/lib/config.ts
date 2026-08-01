/** 監視キーワード一覧（固定値 -> 後々UI化） */
export const KEYWORDS = [
  "Anthropic Claude opus sonnet fable",
  "GPT5 チャットGPT Codex",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー",
  "KDDI au 通信キャリア UQモバイル",
  "NTT NTTデータ NTT東日本 NTT西日本 IOWN 光電融合",
  "Gemini 3 Flash Pro Antigravity TPU",
  "docomo ドコモ ドコモビジネス business",
  "Copilot GitHub Microsoft WorkIQ",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

/** KEYWORDS 配列の各キーワードに対するUI表示名 */
export const KEYWORD_LABELS: Record<string, string> = {
  "Anthropic Claude opus sonnet fable": "Claude",
  "GPT5 チャットGPT Codex": "GPT",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー": "Softbank",
  "KDDI au 通信キャリア UQモバイル": "KDDI",
  "NTT NTTデータ NTT東日本 NTT西日本 IOWN 光電融合": "NTT",
  "Gemini 3 Flash Pro Antigravity TPU": "Gemini",
  "docomo ドコモ ドコモビジネス business": "docomo",
  "Copilot GitHub Microsoft WorkIQ": "Copilot",
};
