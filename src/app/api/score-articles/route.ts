import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import type { NormalizedArticle } from "@/lib/types";

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
