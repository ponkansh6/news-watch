import { NextResponse } from "next/server";
import { toggleFavorite } from "@/lib/db/actions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { articleId } = body;

    if (typeof articleId !== "number" || isNaN(articleId)) {
      return NextResponse.json({ error: "Invalid articleId" }, { status: 400 });
    }

    const favorited = await toggleFavorite(articleId);
    return NextResponse.json({ favorited });
  } catch (err) {
    console.error("[api] favorites/toggle error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
