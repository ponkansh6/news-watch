"use server";

import { cookies, headers } from "next/headers";
import { updateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";

function isAuthenticated(authorization: string | null): boolean {
  const configuredUser = process.env.ADMIN_BASIC_AUTH_USER;
  const configuredPassword = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!configuredUser || !configuredPassword || !authorization?.startsWith("Basic ")) return false;

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;

    const user = Buffer.from(decoded.slice(0, separator));
    const password = Buffer.from(decoded.slice(separator + 1));
    const expectedUser = Buffer.from(configuredUser);
    const expectedPassword = Buffer.from(configuredPassword);
    return (
      user.length === expectedUser.length &&
      timingSafeEqual(user, expectedUser) &&
      password.length === expectedPassword.length &&
      timingSafeEqual(password, expectedPassword)
    );
  } catch {
    return false;
  }
}

/** Invalidate the article list after an authenticated interactive fetch. */
export async function invalidateArticlesAfterFetch(): Promise<{ ok: true }> {
  const requestHeaders = await headers();
  if (!isAuthenticated(requestHeaders.get("authorization"))) {
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
  const cookieStore = await cookies();
  cookieStore.set("source", source, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
}
