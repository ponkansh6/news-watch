import type { NormalizedArticle, ArticleWithTag } from "@/lib/types";
import { batchEmbed, cosineSimilarity, EMBEDDING_MODEL_VERSION } from "@/lib/embeddings";
import { TaskType } from "@google/generative-ai";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  articles as articlesTable,
  keywordEmbeddings as keywordEmbeddingsTable,
} from "@/lib/db/schema";
import { and, inArray, isNotNull } from "drizzle-orm";

/**
 * Minimum normalized similarity score (0-10 scale) required for a keyword tag
 * to be assigned. Articles whose best-matching keyword scores below this
 * threshold are returned with `keyword: null` (no tag assigned) but are still
 * saved to the DB and displayed.
 */
export const TAGGING_THRESHOLD = 6.0;

/**
 * Tag each article with the keyword (from the provided vocabulary) that has the
 * highest vector similarity. Articles whose best-matching keyword scores below
 * TAGGING_THRESHOLD are returned with `keyword: null` (no tag assigned) but are
 * still included in results for display.
 *
 * Embedding cost is minimized by reusing embeddings already stored in the DB:
 * - Article embeddings are reused by URL (set during upsert).
 * - Keyword embeddings are static, so they are persisted in `keyword_embeddings`
 *   and loaded in a single SELECT. Only keywords not yet cached are embedded.
 * On a steady-state run where all articles and keywords are already known, this
 * makes ZERO embedding API calls.
 */
export async function tagArticlesByKeyword(
  articles: NormalizedArticle[],
  keywords: readonly string[],
): Promise<ArticleWithTag[]> {
  if (keywords.length === 0) {
    return articles.map((article) => ({ article, embedding: [], keyword: "", similarity: 0 }));
  }

  // 1. 既存の記事埋め込みをDBから取得（バッチ查询）
  const urls = articles.map((a) => a.url);
  const existingEmbeddings = new Map<string, number[]>();
  try {
    const rows = await db
      .select({ url: articlesTable.url, embedding: articlesTable.embedding })
      .from(articlesTable)
      .where(and(inArray(articlesTable.url, urls), isNotNull(articlesTable.embedding)));
    for (const row of rows) {
      if (row.embedding) {
        existingEmbeddings.set(row.url, JSON.parse(row.embedding));
      }
    }
  } catch {
    // DBが利用できない場合は埋め込みを再計算
  }

  // 2. キーワード埋め込みをDBから取得（1回のSELECT）
  const keywordEmbeddingMap = new Map<string, number[]>();
  try {
    const rows = await db
      .select({
        keyword: keywordEmbeddingsTable.keyword,
        embedding: keywordEmbeddingsTable.embedding,
        model: keywordEmbeddingsTable.model,
      })
      .from(keywordEmbeddingsTable)
      .where(inArray(keywordEmbeddingsTable.keyword, [...keywords]));
    for (const row of rows) {
      if (row.embedding && row.model === EMBEDDING_MODEL_VERSION) {
        keywordEmbeddingMap.set(row.keyword, JSON.parse(row.embedding));
      }
    }
  } catch {
    // テーブル未存在等の場合は全キーワードを再埋め込み
  }

  // 3. 埋め込みが必要なキーワードと記事を収集
  const batchItems: { text: string; taskType: TaskType; key: string }[] = [];
  const missingKeywords: string[] = [];

  for (const keyword of keywords) {
    if (!keywordEmbeddingMap.has(keyword)) {
      missingKeywords.push(keyword);
      batchItems.push({
        text: keyword,
        taskType: TaskType.SEMANTIC_SIMILARITY,
        key: `kw:${keyword}`,
      });
    }
  }

  const uncachedArticles: { index: number; article: NormalizedArticle }[] = [];
  for (let i = 0; i < articles.length; i++) {
    if (!existingEmbeddings.has(articles[i].url)) {
      uncachedArticles.push({ index: i, article: articles[i] });
      const content = `${articles[i].title}\n${articles[i].description || ""}`.trim();
      batchItems.push({
        text: content,
        taskType: TaskType.SEMANTIC_SIMILARITY,
        key: `art:${articles[i].url}`,
      });
    }
  }

  // 4. バッチ埋め込み（必要がある場合のみ）
  const batchResults = new Map<string, number[]>();
  if (batchItems.length > 0) {
    const embeddings = await batchEmbed(
      batchItems.map((item) => ({ text: item.text, taskType: item.taskType })),
    );
    for (let i = 0; i < batchItems.length; i++) {
      batchResults.set(batchItems[i].key, embeddings[i]);
    }

    // 5. 新規キーワード埋め込みをDBにUPSERT
    if (missingKeywords.length > 0) {
      try {
        await db
          .insert(keywordEmbeddingsTable)
          .values(
            missingKeywords.map((kw) => ({
              keyword: kw,
              embedding: JSON.stringify(batchResults.get(`kw:${kw}`) ?? []),
              model: EMBEDDING_MODEL_VERSION,
            })),
          )
          .onConflictDoUpdate({
            target: keywordEmbeddingsTable.keyword,
            set: {
              embedding: sql`excluded.embedding`,
              model: sql`excluded.model`,
            },
          });
      } catch {
        // UPSERT失敗は無視（次回再試行）
      }
    }
  }

  // 6. キーワード埋め込みを構築（DBキャッシュ優先、なければバッチ結果）
  const keywordEmbeddings = keywords.map((keyword) => ({
    keyword,
    embedding: keywordEmbeddingMap.get(keyword) ?? batchResults.get(`kw:${keyword}`) ?? [],
  }));

  // 7. 各記事の埋め込み + キーワードマッチング
  return articles.map((article) => {
    const embedding =
      existingEmbeddings.get(article.url) ?? batchResults.get(`art:${article.url}`) ?? [];

    let bestKeyword: string | null = null;
    let bestSim = -Infinity;
    for (const { keyword, embedding: kwEmb } of keywordEmbeddings) {
      const sim = cosineSimilarity(kwEmb, embedding);
      if (sim > bestSim) {
        bestSim = sim;
        bestKeyword = keyword;
      }
    }
    // Apply threshold: articles below TAGGING_THRESHOLD are not tagged
    if (bestSim * 10 < TAGGING_THRESHOLD) {
      return { article, embedding, keyword: null, similarity: bestSim };
    }
    return { article, embedding, keyword: bestKeyword, similarity: bestSim };
  });
}
