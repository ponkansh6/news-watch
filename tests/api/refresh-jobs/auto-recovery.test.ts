import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  getActiveRefreshSlot: vi.fn(),
  getOwnedRefreshJob: vi.fn(),
  getRefreshJobSources: vi.fn(),
  reconcile: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("workflow/api", () => ({ getRun: mocks.getRun }));
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/db/repository/refresh-job-repository", () => ({
  getActiveRefreshSlot: mocks.getActiveRefreshSlot,
  getOwnedRefreshJob: mocks.getOwnedRefreshJob,
  getRefreshJobSources: mocks.getRefreshJobSources,
}));
vi.mock("@/lib/db/repository/refresh-job-recovery", () => ({
  reconcileTerminalRefreshJob: mocks.reconcile,
}));

import { tryRecoverActiveRefreshJob } from "@/lib/refresh-job-auto-recovery";

const job = { id: "job-1", status: "needs_reconciliation", workflowRunId: "run-1" };

describe("automatic refresh job recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveRefreshSlot.mockResolvedValue({ ownerKind: "job", ownerId: job.id });
    mocks.getOwnedRefreshJob.mockResolvedValue(job);
    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      status: Promise.resolve("failed"),
    });
    mocks.getRefreshJobSources.mockResolvedValue([{ sourceId: "zenn", status: "pending" }]);
    mocks.reconcile.mockResolvedValue({ kind: "reconciled" });
  });

  test("reconciles a known terminal run once", async () => {
    await expect(tryRecoverActiveRefreshJob()).resolves.toBe(true);
    expect(mocks.getRun).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledWith(job.id, job.workflowRunId, "failed");
  });

  test.each([
    ["missing run", false, "failed"],
    ["running run", true, "running"],
  ])("fails closed for a %s", async (_label, exists, status) => {
    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(exists),
      status: Promise.resolve(status),
    });

    await expect(tryRecoverActiveRefreshJob()).resolves.toBe(false);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  test.each(["executing", "unknown"] as const)(
    "fails closed when a source checkpoint is %s",
    async (status) => {
      mocks.getRefreshJobSources.mockResolvedValue([{ sourceId: "zenn", status }]);

      await expect(tryRecoverActiveRefreshJob()).resolves.toBe(false);
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );

  test("invalidates article cache before reconciling saved source results", async () => {
    mocks.getRefreshJobSources.mockResolvedValue([{ sourceId: "zenn", status: "saved" }]);

    await expect(tryRecoverActiveRefreshJob()).resolves.toBe(true);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
    expect(mocks.revalidateTag.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0],
    );
  });
});
