import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import type { ArticleWithTag } from "@/lib/vector-filter";

/** Group tagged articles by assigned keyword, score each group via LLM, and save. Returns count of LLM-scored (saved) articles. */
export async function scoreAndSaveTagged(tagged: ArticleWithTag[]): Promise<number> {
  const byKeyword = new Map<string, ArticleWithTag[]>();
  for (const t of tagged) {
    const list = byKeyword.get(t.keyword);
    if (list) list.push(t);
    else byKeyword.set(t.keyword, [t]);
  }

  let savedCount = 0;
  for (const [keyword, group] of byKeyword) {
    const llmResults = await scoreArticles(
      group.map((t) => ({ title: t.article.title, description: t.article.description })),
      keyword,
    );
    for (let i = 0; i < group.length; i++) {
      const { article, embedding } = group[i];
      const llmResult = llmResults[i] ?? null;
      const relevance = llmResult?.relevance ?? null;
      const usefulness = llmResult?.usefulness ?? null;
      const recency = calcRecencyScore(article.publishedAt);
      const composite = calcCompositeScore(relevance, usefulness, recency);
      await upsertArticle({
        title: article.title,
        description: article.description,
        url: article.url,
        urlToImage: article.urlToImage,
        publishedAt: article.publishedAt,
        sourceName: article.sourceName,
        sourceId: article.sourceId,
        author: article.author,
        keyword,
        summary: llmResult?.summary ?? null,
        relevance,
        usefulness,
        recency,
        score: composite,
        reason: llmResult?.reason ?? null,
        scoredAt: llmResult ? new Date().toISOString() : null,
        embedding: JSON.stringify(embedding),
      });
      if (llmResult) savedCount++;
    }
  }
  return savedCount;
}
