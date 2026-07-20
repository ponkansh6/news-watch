import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { politeFetch } from "@/lib/news/hatena-discovery";
import { searchHatena } from "@/lib/news/hatena";

describe("Hatena Connection Errors", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("politeFetch should reject on abort", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockImplementation((_, { signal }) => {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const promise = politeFetch("https://example.com");
    vi.advanceTimersByTime(15000);
    await expect(promise).rejects.toThrow("The operation was aborted");
    vi.useRealTimers();
  });

  it("politeFetch should reject on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    await expect(politeFetch("https://example.com")).rejects.toThrow("ECONNRESET");
  });

  it("searchHatena should return empty array on connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await searchHatena();

    expect(result).toEqual([]);
  });
});
