import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateContent, mockClaim, mockBegin, mockComplete } = vi.hoisted(() => ({
  mockGenerateContent: vi.fn(),
  mockClaim: vi.fn(),
  mockBegin: vi.fn(),
  mockComplete: vi.fn(),
}));

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = vi.fn().mockReturnValue({ generateContent: mockGenerateContent });
  },
}));

vi.mock("@/lib/db/repository/gemini-rate-limit-repository", () => ({
  claimGeminiAttempt: mockClaim,
  beginGeminiAttempt: mockBegin,
  completeGeminiAttempt: mockComplete,
}));

import { callGemini, geminiLeaseEvidence } from "@/lib/llm/client";

const owner = { ownerId: "owner-1", ownerToken: "secret-token" };

describe("callGemini shared rate limit", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_API_KEY = "test-key";
    mockClaim.mockResolvedValue({ kind: "claimed", owner });
    mockBegin.mockResolvedValue("attempt-1");
    mockComplete.mockResolvedValue(true);
    mockGenerateContent.mockResolvedValue({ response: { text: () => "{}" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("claims, begins, and records each successful HTTP attempt", async () => {
    await expect(callGemini("prompt", 100, 1_000, 0)).resolves.toBe("{}");
    expect(mockClaim).toHaveBeenCalledTimes(1);
    expect(mockBegin).toHaveBeenCalledWith(owner);
    expect(mockComplete).toHaveBeenCalledWith(owner, "attempt-1", "succeeded");
  });

  it("passes only explicit lease evidence to the shared slot claim", async () => {
    const evidence = { kind: "workflow-step-300-v1" as const, deploymentId: "deployment-test" };

    await callGemini("prompt", 100, 1_000, 0, undefined, { leaseEvidence: evidence });

    expect(mockClaim).toHaveBeenCalledWith(evidence);
  });

  it("omits lease evidence when the deployment identifier is absent", () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");

    expect(geminiLeaseEvidence("request-60-v1")).toBeUndefined();
  });

  it("records a failed attempt before retrying", async () => {
    const unavailable = Object.assign(new Error("service unavailable"), { status: 503 });
    mockGenerateContent
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ response: { text: () => "ok" } });
    mockClaim.mockResolvedValue({ kind: "claimed", owner });
    mockBegin.mockResolvedValueOnce("attempt-1").mockResolvedValueOnce("attempt-2");
    vi.stubGlobal("setTimeout", (callback: () => void) => {
      callback();
      return 0;
    });

    await expect(callGemini("prompt", 100, 60_000, 1)).resolves.toBe("ok");
    expect(mockComplete).toHaveBeenNthCalledWith(1, owner, "attempt-1", "failed");
    expect(mockComplete).toHaveBeenNthCalledWith(2, owner, "attempt-2", "succeeded");
    expect(mockClaim).toHaveBeenCalledTimes(2);
  });

  it("releases rate-limited claims and bounds the wait by the deadline", async () => {
    mockClaim.mockResolvedValueOnce({ kind: "rate-limited", retryAfterMs: 10_000 });
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeout = vi.fn((callback: () => void, delayMs: number) => {
      now += delayMs;
      callback();
      return 0;
    });
    vi.stubGlobal("setTimeout", timeout);
    const deadline = now + 1;

    await expect(callGemini("prompt", 100, 100, 0, deadline)).rejects.toThrow("deadline exceeded");
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns wait control to a durable workflow without sending", async () => {
    mockClaim.mockResolvedValue({ kind: "rate-limited", retryAfterMs: 12_345 });

    await expect(
      callGemini("prompt", 100, 10_000, 0, undefined, { rateWaitMode: "throw" }),
    ).rejects.toMatchObject({
      recoverable: true,
      retryAfterMs: 12_345,
      name: "GeminiSlotWaitError",
    });
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns the slot recovery deadline to a durable workflow", async () => {
    mockClaim.mockResolvedValue({ kind: "busy", recoverable: true, retryAfterMs: 300_000 });

    await expect(
      callGemini("prompt", 100, 10_000, 0, undefined, { rateWaitMode: "throw" }),
    ).rejects.toMatchObject({
      recoverable: true,
      retryAfterMs: 300_000,
      name: "GeminiSlotWaitError",
    });
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("does not poll an owner with no automatic recovery deadline", async () => {
    mockClaim.mockResolvedValue({ kind: "busy", recoverable: false });
    const timeout = vi.fn();
    vi.stubGlobal("setTimeout", timeout);

    await expect(callGemini("prompt", 100, 10_000, 0)).rejects.toThrow("unrecoverable owner");
    expect(timeout).not.toHaveBeenCalled();
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns unrecoverable owner status to a durable workflow without a retry delay", async () => {
    mockClaim.mockResolvedValue({ kind: "busy", recoverable: false });

    await expect(
      callGemini("prompt", 100, 10_000, 0, undefined, { rateWaitMode: "throw" }),
    ).rejects.toMatchObject({
      recoverable: false,
      retryAfterMs: undefined,
      name: "GeminiSlotWaitError",
    });
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("does not report success when attempt history cannot be committed", async () => {
    mockComplete.mockResolvedValue(false);

    await expect(callGemini("prompt", 100, 1_000, 0)).rejects.toThrow(
      "failed_to_record_gemini_attempt",
    );
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
