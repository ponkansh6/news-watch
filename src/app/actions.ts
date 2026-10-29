"use server";

import { cookies } from "next/headers";
import { updateTag } from "next/cache";
import { verifyArticlesInvalidationToken } from "@/lib/cache-invalidation-token";
import { isSourceSelection } from "@/lib/sources";

/** Invalidate the article list after an authenticated interactive fetch. */
export async function invalidateArticlesAfterFetch(token: string): Promise<{ ok: true }> {
  if (!verifyArticlesInvalidationToken(token)) {
    throw new Error("Unauthorized");
  }
  updateTag("articles");
  return { ok: true };
}
/**
 * 選択されたニュースソースを `source` cookie に保存する Server Action。
 *
 * RSC レンダリング中の cookie 書き込みは Next.js で禁止されているため、
 * 書き込みは必ずこの Server Action（または Route Handler）経由で行う。
 * 旧 `handleSourceChange`（page.tsx の空ラッパー）は単一関数に統合した。
 */
export async function setSourceCookie(source: string) {
  if (!isSourceSelection(source)) return;

  const cookieStore = await cookies();
  cookieStore.set("source", source, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}
