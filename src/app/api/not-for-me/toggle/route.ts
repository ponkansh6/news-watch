import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { toggleNotForMe } from "@/lib/db";
import { NotForMeToggleBodySchema } from "./schema";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = NotForMeToggleBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid articleId" }, { status: 400 });
    }

    const notForMe = await toggleNotForMe(parsed.data.articleId);
    revalidateTag("not-for-me", "max");
    return NextResponse.json({ notForMe });
  } catch (err) {
    console.error("[api] not-for-me/toggle error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
