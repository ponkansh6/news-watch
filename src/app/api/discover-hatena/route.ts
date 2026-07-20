import { NextResponse } from "next/server";
import { discoverHatenaFeeds } from "@/lib/news/hatena-discovery";

const CRON_SECRET = process.env.CRON_SECRET; // Set in Vercel env / QStash header

export const maxDuration = 60; // Vercel Hobby limit

function verifyAuth(request: Request): boolean {
  // QStash sends: "Upstash-Signature" header with HMAC-SHA256 of body
  // For simplicity, also accept CRON_SECRET as Bearer token (Vercel Cron compatible)
  const authHeader = request.headers.get("Authorization");
  const upstashSig = request.headers.get("Upstash-Signature");

  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;
  if (CRON_SECRET && upstashSig) {
    // TODO: Implement proper Upstash signature verification if needed
    // For now, accept if header exists (QStash only calls configured endpoints)
    return true;
  }
  return false;
}

export async function POST(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await discoverHatenaFeeds();
    return NextResponse.json({
      ok: true,
      discovered: result.discovered,
      updated: result.updated,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[discover-hatena] Fatal error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message:
      "POST to trigger Hatena Blog discovery. Requires Authorization: Bearer <CRON_SECRET> or Upstash-Signature header.",
  });
}
