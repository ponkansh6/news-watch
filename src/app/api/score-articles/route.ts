import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import {
  embedAndFilterArticles,
  SIMILARITY_THRESHOLD,
  resolveThreshold,
  filterByThreshold,
  logFilterStats,
} from "@/lib/vector-filter";

export const maxDuration = 60;

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

export async function POST(request: NextRequest) {
  try {
    // Read raw body first (needed for signature verification)
    const rawBody = await request.text();

    // Verify QStash signature
    if (process.env.NODE_ENV !== "development") {
      const signature = request.headers.get("upstash-signature");
      if (!signature) {
        return NextResponse.json({ error: "Missing signature" }, { status: 401 });
      }

      try {
        await receiver.verify({
          signature,
          body: rawBody,
        });
      } catch (verifyError) {
        console.error(`[score-articles] Signature verification failed:`, String(verifyError));
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    // Parse body
    const parsedBody = JSON.parse(rawBody);
    const { articles, keyword, threshold: thresholdOverride, dryRun } = parsedBody;

    if (!articles || !Array.isArray(articles) || !keyword) {
      return NextResponse.json(
        {
          error:
            "Invalid request body. Expected { articles: NormalizedArticle[], keyword: string }",
        },
        { status: 400 },
      );
    }

    // Embed articles and filter by similarity
    const articlesWithEmbeddings = await embedAndFilterArticles(articles, keyword);
    const effectiveThreshold = resolveThreshold(thresholdOverride);

    const relevantArticles = filterByThreshold(articlesWithEmbeddings, effectiveThreshold);
    logFilterStats({
      keyword,
      threshold: effectiveThreshold,
      total: articlesWithEmbeddings.length,
      passed: relevantArticles.length,
    });

    // Dry-run mode: return filter stats without LLM/DB operations
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        keyword,
        threshold: effectiveThreshold,
        total: articlesWithEmbeddings.length,
        passed: relevantArticles.length,
        filtered: articlesWithEmbeddings.length - relevantArticles.length,
      });
    }

    // Score relevant articles using Gemini
    const llmResults = await scoreArticles(
      relevantArticles.map((item) => ({
        title: item.article.title,
        description: item.article.description,
      })),
      keyword,
    );

    // Save scored articles with proper composite scoring
    let savedCount = 0;
    for (let i = 0; i < articlesWithEmbeddings.length; i++) {
      const { article, embedding, similarity } = articlesWithEmbeddings[i];

      // Find if this article was scored
      const relevantIndex = relevantArticles.findIndex((item) => item.article.url === article.url);
      const llmResult = relevantIndex !== -1 ? llmResults[relevantIndex] : null;

      const relevance = llmResult?.relevance ?? (similarity >= effectiveThreshold ? 0 : null);
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

    return NextResponse.json({
      ok: true,
      message: `Successfully scored and saved ${savedCount} articles for keyword: ${keyword}`,
      saved: savedCount,
      total: articles.length,
    });
  } catch (error) {
    console.error("[score-articles] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 },
    );
  }
}
