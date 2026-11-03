import { afterEach, describe, expect, test, vi } from "vitest";
import { callGemini } from "@/lib/llm/client";

describe("Gemini request deadline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("SDK timeout aborts the in-flight fetch", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-api-key");
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Keep the overall request deadline long enough for the slot claim and
    // attempt bookkeeping; the SDK timeout is what should abort this fetch.
    await expect(callGemini("test prompt", 10, 50, 0, Date.now() + 5_000)).rejects.toThrow(
      "Gemini API error",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });
});
