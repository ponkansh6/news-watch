import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { and, isNotNull, inArray, eq, count, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { keywords, since } = await request.json();
    if (!keywords || !Array.isArray(keywords)) {
      return NextResponse.json({ error: "Invalid keywords" }, { status: 400 });
    }

    const scoredConditions = [inArray(articles.keyword, keywords), isNotNull(articles.score)];
    const processedConditions = [inArray(articles.keyword, keywords), isNotNull(articles.scoredAt)];
    if (since) {
      scoredConditions.push(gte(articles.scoredAt, since));
      processedConditions.push(gte(articles.scoredAt, since));
    }

    // Count how many articles for these keywords have been successfully scored
    // (`scored`) and how many have been processed/attempted (`processed`).
    // Completion is based on `processed` so a partial LLM failure does not make
    // polling hang forever.
    const scoredResult = await db
      .select({ keyword: articles.keyword, scored: count(articles.id) })
      .from(articles)
      .where(and(...scoredConditions))
      .groupBy(articles.keyword);

    const processedResult = await db
      .select({ keyword: articles.keyword, processed: count(articles.id) })
      .from(articles)
      .where(and(...processedConditions))
      .groupBy(articles.keyword);

    const processedByKeyword = new Map(processedResult.map((p) => [p.keyword, p.processed]));
    const status = scoredResult.map((s) => ({
      keyword: s.keyword,
      scored: s.scored,
      processed: processedByKeyword.get(s.keyword) ?? 0,
    }));
    // Include keywords that were processed but have no successful score yet.
    for (const p of processedResult) {
      if (!status.some((s) => s.keyword === p.keyword)) {
        status.push({ keyword: p.keyword, scored: 0, processed: p.processed });
      }
    }

    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
