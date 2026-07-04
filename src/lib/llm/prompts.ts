export const SCORING_PROMPT = `You are a news relevance and usefulness scorer. Given a news article and a keyword, output ONLY valid JSON.

Keyword: {{keyword}}
Title: {{title}}
Description: {{description}}

Score two dimensions 0-10:

1. relevance (関連性): How directly related is this article to the keyword?
   - 10: Directly about the keyword, major development
   - 7-9: Keyword is central, significant update
   - 4-6: Keyword mentioned, moderate relevance
   - 1-3: Keyword tangential, minor mention
   - 0: Irrelevant / false match

2. usefulness (技術者・CTO視点の有用性): How valuable is this article for an engineer or CTO?
   - 10: Deep technical insight + strategic impact, novel approach, benchmark data
   - 7-9: Technical details, architecture decisions, or significant business/technology strategy
   - 4-6: Product announcements with technical or competitive context
   - 1-3: General news, purely operational or niche detail
   - 0: No value for either technical or strategic perspective

Output format (no markdown, no extra text):
{
  "summary": "Japanese 20-40 chars concise summary",
  "relevance": <0-10>,
  "usefulness": <0-10>,
  "reason": "Brief reason in Japanese explaining both scores"
}`;
