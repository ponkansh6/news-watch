import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { scoreArticles } from "@/lib/llm/gemini";
import { upsertArticle } from "@/lib/db/actions";
import { calcRecencyScore, calcCompositeScore } from "@/lib/scoring";
import { tagArticlesByKeyword } from "@/lib/vector-filter";
import { scoreAndSaveTagged } from "@/lib/score-pipeline";
import { KEYWORDS } from "@/lib/config";

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
    const { articles } = parsedBody;

    if (!articles || !Array.isArray(articles)) {
      return NextResponse.json(
        {
          error: "Invalid request body. Expected { articles: NormalizedArticle[] }",
        },
        { status: 400 },
      );
    }

    // Tag articles by highest vector similarity keyword and score/save them
    const tagged = await tagArticlesByKeyword(articles, KEYWORDS);
    const saved = await scoreAndSaveTagged(tagged);

    return NextResponse.json({
      ok: true,
      message: "Successfully scored and saved articles",
      saved,
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
