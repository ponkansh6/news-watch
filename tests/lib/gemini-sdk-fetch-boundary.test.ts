import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockClaim, mockBegin, mockComplete } = vi.hoisted(() => ({
  mockClaim: vi.fn(),
  mockBegin: vi.fn(),
  mockComplete: vi.fn(),
}));

vi.mock("@/lib/db/repository/gemini-rate-limit-repository", () => ({
  claimGeminiAttempt: mockClaim,
  beginGeminiAttempt: mockBegin,
  completeGeminiAttempt: mockComplete,
}));

import { callGemini } from "@/lib/llm/client";

describe("Gemini SDK fetch boundary", () => {
  const events: Array<{ name: string; at: number }> = [];
  const owner = { ownerId: "local-test-owner", ownerToken: "local-test-token" };

  beforeEach(() => {
    events.length = 0;
    vi.stubEnv("GOOGLE_API_KEY", "local-boundary-test-key");
    mockClaim.mockResolvedValue({ kind: "claimed", owner });
    mockBegin.mockResolvedValue("local-attempt");
    mockComplete.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        events.push({ name: "fetch-start", at: performance.now() });
        return Response.json({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "{}" }] },
              finishReason: "STOP",
              index: 0,
            },
          ],
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("observes the SDK callback before its intercepted fetch without network access", async () => {
    await expect(
      callGemini("local prompt", 32, 5_000, 0, undefined, {
        onHttpAttempt: () => events.push({ name: "sdk-callback", at: performance.now() }),
      }),
    ).resolves.toBe("{}");

    expect(events.map(({ name }) => name)).toEqual(["sdk-callback", "fetch-start"]);
    expect(events[1].at).toBeGreaterThanOrEqual(events[0].at);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
