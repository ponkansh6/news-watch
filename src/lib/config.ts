/** 監視キーワード一覧（固定値 -> 後々UI化） */
export const KEYWORDS = [
  "Anthropic Claude AI safety enterprise AI",
  "OpenAI ChatGPT GPT-4 DALL-E 人工知能研究",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー",
  "KDDI au 通信キャリア モバイル IoT 5G",
  "NTT 日本電信電話 NTTデータ NTTドコモ 通信インフラ",
  "Google 検索 GCP Android YouTube Pixel テクノロジー企業",
  "docomo ドコモ NTTドコモ モバイル通信 キャリア",
] as const;

export type Keyword = (typeof KEYWORDS)[number];

/** KEYWORDS 配列の各キーワードに対するUI表示名 */
export const KEYWORD_LABELS: Record<string, string> = {
  "Anthropic Claude AI safety enterprise AI": "Anthropic",
  "OpenAI ChatGPT GPT-4 DALL-E 人工知能研究": "OpenAI",
  "Softbank ソフトバンク モバイル通信 AI投資 テクノロジー": "Softbank",
  "KDDI au 通信キャリア モバイル IoT 5G": "KDDI",
  "NTT 日本電信電話 NTTデータ NTTドコモ 通信インフラ": "NTT",
  "Google 検索 GCP Android YouTube Pixel テクノロジー企業": "Google",
  "docomo ドコモ NTTドコモ モバイル通信 キャリア": "docomo",
};
