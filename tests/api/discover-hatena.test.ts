import { describe, expect, test, vi, afterAll } from "vitest";
import { NextRequest } from "next/server";

// Mock the discovery module so the route handler never hits the network/DB.
vi.mock("@/lib/news/hatena-discovery", () => ({
  discoverHatenaFeeds: vi.fn(),
}));

// Set CRON_SECRET before the route module is evaluated (it reads env at top level).
vi.stubEnv("CRON_SECRET", "test-secret");

const { POST } = await import("@/app/api/discover-hatena/route");
const { discoverHatenaFeeds } = await import("@/lib/news/hatena-discovery");

describe("POST /api/discover-hatena", () => {
  test("returns 401 without auth header", async () => {
    const req = new NextRequest("http://localhost/api/discover-hatena", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 401 with wrong bearer token", async () => {
    const req = new NextRequest("http://localhost/api/discover-hatena", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test("returns 200 with valid bearer token and discovery result", async () => {
    vi.mocked(discoverHatenaFeeds).mockResolvedValue({
      discovered: 3,
      updated: 1,
      errors: [],
    });

    const req = new NextRequest("http://localhost/api/discover-hatena", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.discovered).toBe(3);
    expect(data.updated).toBe(1);
    expect(data.errors).toEqual([]);
    expect(typeof data.timestamp).toBe("string");
    expect(discoverHatenaFeeds).toHaveBeenCalledOnce();
  });

  test("returns 500 shape when discovery throws", async () => {
    vi.mocked(discoverHatenaFeeds).mockRejectedValue(new Error("boom"));

    const req = new NextRequest("http://localhost/api/discover-hatena", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
