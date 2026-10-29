import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  beginGeminiAttempt,
  claimGeminiAttempt,
  completeGeminiAttempt,
  getGeminiRateWindow,
  getGeminiRateOwnerStatus,
  releaseFencedGeminiOwner,
} from "@/lib/db/repository/gemini-rate-limit-repository";
import { geminiRequestAttempts, geminiRequestSlot } from "@/lib/db/schema";

beforeEach(async () => {
  await db.delete(geminiRequestAttempts);
  await db.delete(geminiRequestSlot);
});

afterEach(async () => {
  await db.delete(geminiRequestAttempts);
  await db.delete(geminiRequestSlot);
});

describe("Gemini rate-limit repository", () => {
  test("allows one concurrent sender and keeps the slot until attempt completion", async () => {
    const claims = await Promise.all(Array.from({ length: 16 }, () => claimGeminiAttempt()));
    const admitted = claims.filter((claim) => claim.kind === "claimed");
    expect(admitted).toHaveLength(1);

    const owner = admitted[0]!.owner;
    expect(await claimGeminiAttempt()).toMatchObject({ kind: "busy" });
    const attemptId = await beginGeminiAttempt(owner);
    expect(
      await completeGeminiAttempt({ ...owner, ownerToken: "wrong-token" }, attemptId, "succeeded"),
    ).toBe(false);
    expect(await claimGeminiAttempt()).toMatchObject({ kind: "busy" });
    expect(await completeGeminiAttempt(owner, attemptId, "succeeded")).toBe(true);
  });

  test("counts failed attempts and rejects the sixteenth completion in a rolling window", async () => {
    for (let index = 0; index < 15; index++) {
      const claim = await claimGeminiAttempt();
      expect(claim.kind).toBe("claimed");
      if (claim.kind !== "claimed") throw new Error("expected an admitted attempt");
      const attemptId = await beginGeminiAttempt(claim.owner);
      expect(
        await completeGeminiAttempt(claim.owner, attemptId, index === 0 ? "failed" : "succeeded"),
      ).toBe(true);
    }

    const next = await claimGeminiAttempt();
    expect(next.kind).toBe("rate-limited");
    if (next.kind === "rate-limited") expect(next.retryAfterMs).toBeGreaterThan(0);
    expect(await getGeminiRateWindow()).toMatchObject({ recentAttempts: 15 });
  });

  test("fenced recovery records an ambiguous in-flight attempt before releasing", async () => {
    const claim = await claimGeminiAttempt();
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("expected an admitted attempt");
    const attemptId = await beginGeminiAttempt(claim.owner);

    expect(await releaseFencedGeminiOwner(claim.owner.ownerId, attemptId)).toBe(true);
    const [attempt] = await db
      .select()
      .from(geminiRequestAttempts)
      .where(eq(geminiRequestAttempts.id, attemptId));
    expect(attempt).toMatchObject({ outcome: "ambiguous" });
    expect(attempt?.completedAt).toBeTruthy();
    expect((await claimGeminiAttempt()).kind).toBe("claimed");
  });

  test("reports stranded owner metadata without exposing token material", async () => {
    const claim = await claimGeminiAttempt();
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("expected an admitted attempt");
    const attemptId = await beginGeminiAttempt(claim.owner);

    const status = await getGeminiRateOwnerStatus();
    expect(status).toEqual({
      ownerId: claim.owner.ownerId,
      acquiredAt: expect.any(String),
      attempt: {
        id: attemptId,
        startedAt: expect.any(String),
        outcome: "started",
      },
    });
    expect(JSON.stringify(status)).not.toContain(claim.owner.ownerToken);
  });

  test("does not automatically recover an owner without a deployment lease", async () => {
    const claim = await claimGeminiAttempt();
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("expected an admitted attempt");

    await db.update(geminiRequestSlot).set({ acquiredAt: "2000-01-01T00:00:00.000Z" });

    const next = await claimGeminiAttempt();
    expect(next).toEqual({ kind: "busy", recoverable: false });
    const [slot] = await db.select().from(geminiRequestSlot);
    expect(slot?.ownerId).toBe(claim.owner.ownerId);
  });

  test("recovers an expired pinned workflow owner and counts its started send as ambiguous", async () => {
    const first = await claimGeminiAttempt({
      kind: "workflow-step-300-v1",
      deploymentId: "commit-a",
    });
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected an admitted attempt");
    const attemptId = await beginGeminiAttempt(first.owner);

    const lease = await db.$client.execute({
      sql: `SELECT (julianday(recovery_after) - julianday(acquired_at)) * 86400 AS lease_seconds
            FROM gemini_request_slot WHERE id = 1`,
      args: [],
    });
    const leaseSeconds = Number(lease.rows[0]?.lease_seconds);
    expect(leaseSeconds).toBeGreaterThan(359.98);
    expect(leaseSeconds).toBeLessThan(360.02);

    // Move the deadline relative to SQLite's own clock to exercise both sides
    // of the fence without sleeping or depending on the test process clock.
    await db.$client.execute({
      sql: `UPDATE gemini_request_slot
            SET recovery_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+2 seconds')
            WHERE id = 1`,
      args: [],
    });

    const waiting = await claimGeminiAttempt();
    expect(waiting.kind).toBe("busy");
    if (waiting.kind === "busy") {
      expect(waiting.recoverable).toBe(true);
      if (waiting.recoverable) {
        expect(waiting.retryAfterMs).toBeGreaterThan(0);
        expect(waiting.retryAfterMs).toBeLessThan(2_500);
      }
    }

    await db.$client.execute({
      sql: `UPDATE gemini_request_slot
            SET recovery_after = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = 1`,
      args: [],
    });
    const replacements = await Promise.all(Array.from({ length: 16 }, () => claimGeminiAttempt()));
    expect(replacements.filter((claim) => claim.kind === "claimed")).toHaveLength(1);
    expect(replacements.filter((claim) => claim.kind === "busy")).toHaveLength(15);

    const [attempt] = await db
      .select()
      .from(geminiRequestAttempts)
      .where(eq(geminiRequestAttempts.id, attemptId));
    expect(attempt).toMatchObject({ outcome: "ambiguous" });
    expect(attempt?.completedAt).toBeTruthy();
    expect(await getGeminiRateWindow()).toMatchObject({ recentAttempts: 1 });
  });

  test("uses the 120-second fence only for an explicitly identified request lease", async () => {
    const claim = await claimGeminiAttempt({ kind: "request-60-v1", deploymentId: "deployment-a" });
    expect(claim.kind).toBe("claimed");
    if (claim.kind !== "claimed") throw new Error("expected an admitted attempt");

    const lease = await db.$client.execute({
      sql: `SELECT (julianday(recovery_after) - julianday(acquired_at)) * 86400 AS lease_seconds
            FROM gemini_request_slot WHERE id = 1`,
      args: [],
    });
    const leaseSeconds = Number(lease.rows[0]?.lease_seconds);
    expect(leaseSeconds).toBeGreaterThan(119.98);
    expect(leaseSeconds).toBeLessThan(120.02);

    const busy = await claimGeminiAttempt();
    expect(busy.kind).toBe("busy");
    if (busy.kind === "busy") {
      expect(busy.recoverable).toBe(true);
      if (busy.recoverable) expect(busy.retryAfterMs).toBeGreaterThan(0);
    }
  });
});
