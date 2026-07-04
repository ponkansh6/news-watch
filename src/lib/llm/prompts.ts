export const SCORING_PROMPT = `You are a news relevance scorer. Given a news article and a keyword, output ONLY valid JSON.

Keyword: {{keyword}}
Title: {{title}}
Description: {{description}}

Score 0-10 based on:
- 10: Directly about the keyword, major development
- 7-9: Keyword is central, significant update
- 4-6: Keyword mentioned, moderate relevance
- 1-3: Keyword tangential, minor mention
- 0: Irrelevant / false match

Output format (no markdown, no extra text):
{
  "summary": "Japanese 20-40 chars concise summary",
  "score": <0-10>,
  "reason": "Brief reason in Japanese"
}`;
