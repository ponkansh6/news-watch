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

    const conditions = [inArray(articles.keyword, keywords), isNotNull(articles.score)];
    if (since) {
      conditions.push(gte(articles.scoredAt, since));
    }

    // Count how many articles for these keywords have been scored
    const result = await db
      .select({
        keyword: articles.keyword,
        scored: count(articles.id),
      })
      .from(articles)
      .where(and(...conditions))
      .groupBy(articles.keyword);

    return NextResponse.json({ ok: true, status: result });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
