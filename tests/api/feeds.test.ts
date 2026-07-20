import { describe, expect, test, vi, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getHatenaFeeds, reactivateHatenaFeed } from "@/lib/db/actions";

vi.mock("@/lib/db/actions", () => ({
  getHatenaFeeds: vi.fn(),
  reactivateHatenaFeed: vi.fn(),
}));

const { GET, POST } = await import("@/app/api/feeds/route");

describe("GET /api/feeds", () => {
  test("returns 200 with feeds", async () => {
    const mockFeeds = [{ id: 1, domain: "test.com", status: "active" }];
    vi.mocked(getHatenaFeeds).mockResolvedValue(mockFeeds as any);

    const req = new NextRequest("http://localhost/api/feeds", { method: "GET" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockFeeds);
  });
});

describe("POST /api/feeds", () => {
  test("returns 200 when reactivate succeeds", async () => {
    vi.mocked(reactivateHatenaFeed).mockResolvedValue(true);

    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      body: JSON.stringify({ id: 1 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(reactivateHatenaFeed).toHaveBeenCalledWith(1);
  });

  test("returns 400 when id is missing", async () => {
    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 500 when reactivate fails", async () => {
    vi.mocked(reactivateHatenaFeed).mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      body: JSON.stringify({ id: 1 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

afterAll(() => {
  vi.clearAllMocks();
});
