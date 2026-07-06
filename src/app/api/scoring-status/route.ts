import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { and, isNotNull, inArray, eq, count } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { keywords } = await request.json();
    if (!keywords || !Array.isArray(keywords)) {
      return NextResponse.json({ error: "Invalid keywords" }, { status: 400 });
    }

    // Count how many articles for these keywords have been scored
    const result = await db
      .select({
        keyword: articles.keyword,
        scored: count(articles.id),
      })
      .from(articles)
      .where(and(inArray(articles.keyword, keywords), isNotNull(articles.score)))
      .groupBy(articles.keyword);

    return NextResponse.json({ ok: true, status: result });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
