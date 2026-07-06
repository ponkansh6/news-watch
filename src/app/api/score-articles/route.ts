import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import type { NormalizedArticle } from "@/lib/types";

export const maxDuration = 60;

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || "",
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || "",
});

/** Algorithmic recency score (0-10) based on publishedAt freshness. */
function calcRecencyScore(publishedAt: string): number {
  const now = Date.now();
  const pub = new Date(publishedAt).getTime();
  const days = (now - pub) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  if (days <= 30) return 2;
  return 0;
}

export async function POST(request: NextRequest) {
  try {
    // Read raw body first (needed for signature verification)
    const rawBody = await request.text();

    // Verify QStash signature
    const signature = request.headers.get("upstash-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    try {
      await receiver.verify({
        signature,
        body: rawBody,
        url: request.url,
      });
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse body
    const parsedBody = JSON.parse(rawBody);
    const { articles, keyword } = parsedBody;

    if (!articles || !Array.isArray(articles) || !keyword) {
      return NextResponse.json(
        {
          error:
            "Invalid request body. Expected { articles: NormalizedArticle[], keyword: string }",
        },
        { status: 400 },
      );
    }

    // Score articles using Gemini
    const llmResults = await scoreArticles(
      articles.map((a: NormalizedArticle) => ({ title: a.title, description: a.description })),
      keyword,
    );

    // Save scored articles with proper composite scoring
    let savedCount = 0;
    for (let i = 0; i < articles.length; i++) {
      const llmResult = llmResults[i] ?? null;
      const article = articles[i];

      const relevance = llmResult?.relevance ?? null;
      const usefulness = llmResult?.usefulness ?? null;
      const recency = calcRecencyScore(article.publishedAt);

      // composite = relevance(30%) + usefulness(40%) + recency(30%)
      const composite =
        relevance !== null && usefulness !== null
          ? Math.round((relevance * 0.3 + usefulness * 0.4 + recency * 0.3) * 10) / 10
          : null;

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
