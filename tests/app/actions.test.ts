import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSet, mockUpdateTag } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mockSet })),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

import { invalidateArticlesAfterFetch, setSourceCookie } from "../../src/app/actions";

describe("setSourceCookie (Server Action)", () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockUpdateTag.mockClear();
    vi.unstubAllEnvs();
  });

  it("writes the source cookie via cookieStore.set", async () => {
    await setSourceCookie("qiita");
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      "source",
      "qiita",
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      }),
    );
  });

  it("does not write a cookie for an unknown source", async () => {
    await setSourceCookie("unknown-source");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("immediately invalidates the fixed articles tag for an authenticated admin", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { issueArticlesInvalidationToken } = await import("@/lib/cache-invalidation-token");
    const token = issueArticlesInvalidationToken();
    expect(token).toEqual(expect.any(String));

    await expect(invalidateArticlesAfterFetch(token!)).resolves.toEqual({ ok: true });
    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
    expect(mockUpdateTag).toHaveBeenCalledWith("articles");
  });

  it("rejects an unauthenticated article cache invalidation", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    await expect(invalidateArticlesAfterFetch("")).rejects.toThrow("Unauthorized");
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a modified cache invalidation token", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { issueArticlesInvalidationToken } = await import("@/lib/cache-invalidation-token");
    const token = issueArticlesInvalidationToken()!;

    await expect(invalidateArticlesAfterFetch(`${token}x`)).rejects.toThrow("Unauthorized");
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
