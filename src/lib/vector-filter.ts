import type { NormalizedArticle } from "@/lib/types";
import { embedArticle, embedQuery, cosineSimilarity } from "@/lib/embeddings";

export interface ArticleWithTag {
  article: NormalizedArticle;
  embedding: number[];
  keyword: string; // best-matching term (highest vector similarity)
  similarity: number; // cosine similarity to the best-matching term
}

/**
 * Tag each article with the keyword (from the provided vocabulary) that has the
 * highest vector similarity. Every article is assigned a tag — there is no
 * threshold filtering. Keyword embeddings are computed once and reused.
 */
export async function tagArticlesByKeyword(
  articles: NormalizedArticle[],
  keywords: readonly string[],
): Promise<ArticleWithTag[]> {
  if (keywords.length === 0) {
    return articles.map((article) => ({ article, embedding: [], keyword: "", similarity: 0 }));
  }

  const keywordEmbeddings = await Promise.all(
    keywords.map(async (keyword) => ({
      keyword,
      embedding: await embedQuery(keyword),
    })),
  );

  return Promise.all(
    articles.map(async (article) => {
      const embedding = await embedArticle(article.title, article.description);
      let bestKeyword = keywordEmbeddings[0].keyword;
      let bestSim = -Infinity;
      for (const { keyword, embedding: kwEmb } of keywordEmbeddings) {
        const sim = cosineSimilarity(kwEmb, embedding);
        if (sim > bestSim) {
          bestSim = sim;
          bestKeyword = keyword;
        }
      }
      return { article, embedding, keyword: bestKeyword, similarity: bestSim };
    }),
  );
}
