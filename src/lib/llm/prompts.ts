export const SCORING_PROMPT = `You are a news value assessor for engineers and CTOs. Given a news article, output ONLY valid JSON.

Title: {{title}}
Description: {{description}}

Score one dimension 0-10:

usefulness (技術者・CTO視点の有用性): How valuable is this article for an engineer or CTO?
  - 10: Deep technical insight + strategic impact, novel approach, benchmark data, architecture decisions
  - 7-9: Technical details, significant business/technology strategy, competitive analysis with technical depth
  - 4-6: Product announcements with technical or competitive context, incremental updates
  - 1-3: General news, purely operational or niche detail, marketing fluff
  - 0: No value for either technical or strategic perspective

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

{{articles}}`;
