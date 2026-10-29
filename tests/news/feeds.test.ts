import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchAndParseFeed, fetchAndParseFeedStrict } from "@/lib/news/feeds";

let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("fetchAndParseFeed", () => {
  test("fetches one feed and passes its XML to the supplied parser", async () => {
    const xml = "<feed><item>article</item></feed>";
    const parse = vi.fn((value: string) => [{ xml: value }]);
    fetchMock.mockResolvedValue({ ok: true, text: async () => xml });

    const result = await fetchAndParseFeed("https://example.com/feed", "example", parse, {
      headers: { "User-Agent": "news-watch-test" },
    });

    expect(result).toEqual([{ xml }]);
    expect(parse).toHaveBeenCalledWith(xml);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/feed",
      expect.objectContaining({
        headers: { "User-Agent": "news-watch-test" },
      }),
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "User-Agent": "news-watch-test" },
    });
  });

  test("returns an empty array without parsing an empty feed body", async () => {
    const parse = vi.fn(() => []);
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });

    const result = await fetchAndParseFeed("https://example.com/feed", "example", parse);

    expect(result).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  test("returns an empty array when fetching the feed fails", async () => {
    const parse = vi.fn(() => []);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const result = await fetchAndParseFeed("https://example.com/feed", "example", parse);

    expect(result).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  test("propagates parser errors so callers can choose their own failure boundary", async () => {
    const parse = vi.fn(() => {
      throw new Error("invalid feed");
    });
    fetchMock.mockResolvedValue({ ok: true, text: async () => "<invalid />" });

    await expect(fetchAndParseFeed("https://example.com/feed", "example", parse)).rejects.toThrow(
      "invalid feed",
    );
  });
});

describe("fetchAndParseFeedStrict", () => {
  test("preserves a healthy empty feed as an empty result", async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => "" });

    await expect(
      fetchAndParseFeedStrict("https://example.com/feed", "example", () => []),
    ).resolves.toEqual([]);
  });

  test("reports an HTTP failure instead of turning it into an empty feed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      fetchAndParseFeedStrict("https://example.com/feed", "example", () => []),
    ).rejects.toMatchObject({
      name: "SourceFetchError",
      sourceName: "example",
      kind: "http",
      status: 503,
    });
  });

  test("reports transport and parser failures with their distinct kinds", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(
      fetchAndParseFeedStrict("https://example.com/feed", "example", () => []),
    ).rejects.toMatchObject({ name: "SourceFetchError", kind: "network" });

    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => "invalid" });
    await expect(
      fetchAndParseFeedStrict("https://example.com/feed", "example", () => {
        throw new Error("invalid XML");
      }),
    ).rejects.toMatchObject({ name: "SourceFetchError", kind: "parse" });
  });
});

afterAll(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
