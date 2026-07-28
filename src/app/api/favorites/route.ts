import { NextResponse } from "next/server";
import { getFavoriteIds } from "@/lib/db/actions";

export async function GET() {
  try {
    const ids = await getFavoriteIds();
    return NextResponse.json({ ids });
  } catch (err) {
    console.error("[api] favorites GET error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
