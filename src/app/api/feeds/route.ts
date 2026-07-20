import { NextResponse } from "next/server";
import { getHatenaFeeds, reactivateHatenaFeed } from "@/lib/db/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feeds = await getHatenaFeeds();
    return NextResponse.json(feeds);
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch feeds" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id } = body;

    if (typeof id !== "number") {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const success = await reactivateHatenaFeed(id);
    if (!success) {
      return NextResponse.json({ error: "Failed to reactivate feed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
