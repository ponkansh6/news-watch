export const SCORING_PROMPT = `You are a news value assessor for engineers and tech leaders. Given a news article, output ONLY valid JSON.

Title: {{title}}
Description: {{description}}

Score one dimension 0-10:

usefulness (技術者・テックリーダー視点の有用性): この記事は「エンジニアやテックリーダーにとって」どれだけ有用かを評価してください。一般的な有用性（大衆受けや広汎な人気、消費者向けの訴求力）ではなく、技術的・戦略的な価値のみを評価の対象とします。
  - 10: 深い技術的洞察＋戦略的インパクト、新規アプローチ、ベンチマークデータ、アーキテクチャ決定、具体的な実装指針
  - 7-9: 技術的詳細、重要な事業/技術戦略、技術的深さのある競合分析、エンジニア/リーダーが実行可能な意思決定
  - 4-6: 明確な技術・競合文脈を伴う製品/機能発表、関連性のある段階的アップデート
  - 1-3: 技術的・戦略的深度の薄い一般的なテックニュース、運用上の細部、マーケティング色の強い記事
  - 0: エンジニアやテックリーダーにとって価値がない（消費者/ライフスタイル向け、または技術的・戦略的示唆のない一般ニュース）

Output format (no markdown, no extra text):
{
  "summary": "Japanese 20-40 chars concise summary of the article's core content/value (keyword-independent)",
  "usefulness": <0-10>,
  "reason": "Brief reason in Japanese explaining the usefulness score"
}
`;

export const BATCH_SCORING_PROMPT = `Score {{articleCount}} articles.
Output ONLY valid JSON (a JSON object). Use exactly this structure:
{
  "results": [
    {"summary":"Japanese 20-40 chars","usefulness":0-10,"reason":"Brief Japanese reason"}
  ]
}
One entry per article, in the same order. No markdown, no extra text.

Usefulness criteria (技術者・テックリーダー視点の有用性): この記事は「エンジニアやテックリーダーにとって」どれだけ有用かを評価してください。一般的な有用性（大衆受けや広汎な人気、消費者向けの訴求力）ではなく、技術的・戦略的な価値のみを評価の対象とします。
  - 10: 深い技術的洞察＋戦略的インパクト、新規アプローチ、ベンチマークデータ、アーキテクチャ決定、具体的な実装指針
  - 7-9: 技術的詳細、重要な事業/技術戦略、技術的深さのある競合分析、エンジニア/リーダーが実行可能な意思決定
  - 4-6: 明確な技術・競合文脈を伴う製品/機能発表、関連性のある段階的アップデート
  - 1-3: 技術的・戦略的深度の薄い一般的なテックニュース、運用上の細部、マーケティング色の強い記事
  - 0: エンジニアやテックリーダーにとって価値がない（消費者/ライフスタイル向け、または技術的・戦略的示唆のない一般ニュース）

{{articles}}`;
