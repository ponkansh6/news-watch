import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/favorites/toggle/route";
import { toggleFavorite } from "@/lib/db";
import { revalidateTag } from "next/cache";

vi.mock("@/lib/db", () => ({
  toggleFavorite: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

describe("POST /api/favorites/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 without toggling or revalidating for invalid input", async () => {
    const req = new Request("http://localhost/api/favorites/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: "123" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid articleId" });
    expect(toggleFavorite).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("toggles and revalidates the favorites tag", async () => {
    vi.mocked(toggleFavorite).mockResolvedValue(true);
    const req = new Request("http://localhost/api/favorites/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: 123 }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favorited: true });
    expect(toggleFavorite).toHaveBeenCalledWith(123);
    expect(revalidateTag).toHaveBeenCalledWith("favorites", "max");
    expect(vi.mocked(toggleFavorite).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
  });

  it("returns 500 and preserves the favorites log prefix when the DB toggle fails", async () => {
    vi.mocked(toggleFavorite).mockRejectedValue(new Error("DB error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = new Request("http://localhost/api/favorites/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: 123 }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(consoleError).toHaveBeenCalledWith("[api] favorites/toggle error:", expect.any(Error));
    expect(revalidateTag).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
