import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  getFavoriteStats,
  getLatestPreferenceProfile,
  getFavoriteArticles,
  savePreferenceProfile,
} from "@/lib/db";
import {
  analyzeFavorites,
  isUsablePreferenceAnalysis,
  buildPreferencePromptSection,
  LLM_MODEL,
} from "@/lib/llm";
import {
  PREFERENCE_MIN_FAVORITES,
  PREFERENCE_ANALYSIS_COOLDOWN_MS,
  HTTP_STATUS_TOO_MANY_REQUESTS,
} from "@/lib/constants";
import { AnalyzeFavoritesBodySchema } from "./schema";
import type { FavoriteInput } from "@/lib/llm";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = AnalyzeFavoritesBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const force = parsed.data?.force ?? false;
    const { count, maxId } = await getFavoriteStats();

    if (count < PREFERENCE_MIN_FAVORITES) {
      return NextResponse.json(
        {
          error: "Not enough favorites to analyze",
          required: PREFERENCE_MIN_FAVORITES,
          current: count,
        },
        { status: 400 },
      );
    }

    const latest = await getLatestPreferenceProfile();

    if (
      !force &&
      latest &&
      Date.now() - new Date(latest.createdAt).getTime() < PREFERENCE_ANALYSIS_COOLDOWN_MS
    ) {
      const retryAfterMs =
        PREFERENCE_ANALYSIS_COOLDOWN_MS - (Date.now() - new Date(latest.createdAt).getTime());
      return NextResponse.json(
        { error: "Analysis cooldown active", retryAfterMs },
        {
          status: HTTP_STATUS_TOO_MANY_REQUESTS,
          headers: {
            "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
          },
        },
      );
    }

    if (latest && latest.favoriteCount === count && latest.favoriteMaxId === maxId) {
      return NextResponse.json({
        reused: true,
        profile: {
          summary: latest.analysis.summary,
          themes: latest.analysis.themes,
          createdAt: latest.createdAt,
          favoriteCount: latest.favoriteCount,
        },
      });
    }

    const articles = await getFavoriteArticles();
    const items: FavoriteInput[] = articles.map((a) => ({
      title: a.title,
      summary: a.summary,
      keywordLabel: a.keywordLabel,
      reason: a.reason,
      score: a.score,
    }));

    const analysis = await analyzeFavorites(items);

    if (!analysis || !isUsablePreferenceAnalysis(analysis)) {
      console.warn("[api] favorites/analyze analysis not usable:", analysis);
      return NextResponse.json({ error: "Analysis failed" }, { status: 502 });
    }

    const promptSection = buildPreferencePromptSection(analysis);
    await savePreferenceProfile({
      analysis,
      promptSection,
      favoriteCount: count,
      favoriteMaxId: maxId,
      model: LLM_MODEL,
    });

    revalidateTag("preference-profile", "max");

    return NextResponse.json({
      reused: false,
      profile: {
        summary: analysis.summary,
        themes: analysis.themes,
        createdAt: new Date().toISOString(),
        favoriteCount: count,
      },
    });
  } catch (err) {
    console.error("[api] favorites/analyze error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
