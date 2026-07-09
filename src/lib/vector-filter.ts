import type { NormalizedArticle } from "@/lib/types";
import { embedArticle, embedQuery, cosineSimilarity } from "@/lib/embeddings";

export interface ArticleWithEmbedding {
  article: NormalizedArticle;
  embedding: number[];
  similarity: number;
}

export const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? "0.75");

export async function embedAndFilterArticles(
  articles: NormalizedArticle[],
  keyword: string,
): Promise<ArticleWithEmbedding[]> {
  const keywordEmbedding = await embedQuery(keyword);
  return Promise.all(
    articles.map(async (article) => {
      const embedding = await embedArticle(article.title, article.description);
      const similarity = cosineSimilarity(keywordEmbedding, embedding);
      return { article, embedding, similarity };
    }),
  );
}

// 閾値オーバーライドを解決。0<=v<=1 でない場合は SIMILARITY_THRESHOLD にフォールバック。
export function resolveThreshold(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0 && override <= 1) {
    return override;
  }
  return SIMILARITY_THRESHOLD;
}

// 類似度閾値でフィルタ
export function filterByThreshold(items: ArticleWithEmbedding[], threshold: number): ArticleWithEmbedding[] {
  return items.filter((item) => item.similarity >= threshold);
}

// フィルタ統計を構造化ログ出力
export function logFilterStats(opts: {
  keyword: string;
  threshold: number;
  total: number;
  passed: number;
}): void {
  const filtered = opts.total - opts.passed;
  const filterRate = opts.total > 0 ? filtered / opts.total : 0;
  console.log(
    `[vector-filter] keyword="${opts.keyword}" threshold=${opts.threshold} total=${opts.total} passed=${opts.passed} filtered=${filtered} filterRate=${filterRate.toFixed(2)}`,
  );
}