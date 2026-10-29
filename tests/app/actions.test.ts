import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSet, mockHeaders, mockUpdateTag } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockHeaders: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: mockSet })),
  headers: () => mockHeaders(),
}));

vi.mock("next/cache", () => ({ updateTag: mockUpdateTag }));

import { invalidateArticlesAfterFetch, setSourceCookie } from "../../src/app/actions";

describe("setSourceCookie (Server Action)", () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockHeaders.mockReset();
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

  it("immediately invalidates the fixed articles tag for an authenticated admin", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");
    mockHeaders.mockResolvedValue(
      new Headers({ Authorization: `Basic ${Buffer.from("admin:password").toString("base64")}` }),
    );

    await expect(invalidateArticlesAfterFetch()).resolves.toEqual({ ok: true });
    expect(mockUpdateTag).toHaveBeenCalledTimes(1);
    expect(mockUpdateTag).toHaveBeenCalledWith("articles");
  });

  it("rejects an unauthenticated article cache invalidation", async () => {
    vi.stubEnv("ADMIN_BASIC_AUTH_USER", "admin");
    vi.stubEnv("ADMIN_BASIC_AUTH_PASSWORD", "password");
    mockHeaders.mockResolvedValue(new Headers());

    await expect(invalidateArticlesAfterFetch()).rejects.toThrow("Unauthorized");
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
