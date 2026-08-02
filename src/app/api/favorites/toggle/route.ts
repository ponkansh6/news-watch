import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { toggleFavorite } from "@/lib/db";
import { ToggleFavoriteBodySchema } from "./schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ToggleFavoriteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid articleId" }, { status: 400 });
    }

    const favorited = await toggleFavorite(parsed.data.articleId);
    revalidateTag("favorites", "max");
    return NextResponse.json({ favorited });
  } catch (err) {
    console.error("[api] favorites/toggle error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
