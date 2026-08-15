import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/not-for-me/toggle/route";
import { toggleNotForMe } from "@/lib/db";
import { revalidateTag } from "next/cache";

vi.mock("@/lib/db", () => ({
  toggleNotForMe: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

describe("POST /api/not-for-me/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when articleId is missing or invalid", async () => {
    const req1 = new Request("http://localhost/api/not-for-me/toggle", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res1 = await POST(req1 as any);
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toBe("Invalid articleId");

    const req2 = new Request("http://localhost/api/not-for-me/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: "abc" }),
    });
    const res2 = await POST(req2 as any);
    expect(res2.status).toBe(400);

    expect(toggleNotForMe).not.toHaveBeenCalled();
  });

  it("toggles successfully and revalidates tags", async () => {
    vi.mocked(toggleNotForMe).mockResolvedValue(true);

    const req = new Request("http://localhost/api/not-for-me/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: 123 }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ notForMe: true });

    expect(toggleNotForMe).toHaveBeenCalledWith(123);
    expect(revalidateTag).toHaveBeenCalledWith("not-for-me", "max");
  });

  it("returns 500 when toggleNotForMe throws", async () => {
    vi.mocked(toggleNotForMe).mockRejectedValue(new Error("DB error"));

    const req = new Request("http://localhost/api/not-for-me/toggle", {
      method: "POST",
      body: JSON.stringify({ articleId: 123 }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Internal Server Error");
  });
});
