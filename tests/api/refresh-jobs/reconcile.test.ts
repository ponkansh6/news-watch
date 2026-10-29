import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(() => true),
  getRun: vi.fn(),
  getJob: vi.fn(),
  getSources: vi.fn(),
  reconcile: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/news/api-auth", () => ({ isNewsApiAuthorized: mocks.authorized }));
vi.mock("workflow/api", () => ({ getRun: mocks.getRun }));
vi.mock("@/lib/db/repository/refresh-job-repository", () => ({
  getOwnedRefreshJob: mocks.getJob,
  getRefreshJobSources: mocks.getSources,
}));
vi.mock("@/lib/db/repository/refresh-job-recovery", () => ({
  reconcileTerminalRefreshJob: mocks.reconcile,
}));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

import { POST } from "@/app/api/refresh-jobs/[jobId]/reconcile/route";

const job = {
  id: "job-1",
  status: "needs_reconciliation",
  workflowRunId: "wrun-1",
};
const invalidated = {
  sourceId: "zenn",
  status: "invalidated",
  errorCode: null,
};

function request() {
  return new Request("https://news.test/api/refresh-jobs/job-1/reconcile", { method: "POST" });
}

const context = { params: Promise.resolve({ jobId: job.id }) };

describe("POST /api/refresh-jobs/[jobId]/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorized.mockReturnValue(true);
    mocks.getJob.mockResolvedValue(job);
    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      status: Promise.resolve("failed"),
    });
    mocks.getSources.mockResolvedValue([invalidated]);
    mocks.reconcile.mockResolvedValue({
      kind: "reconciled",
      status: "failed",
      invalidatedCount: 0,
      skippedCount: 1,
    });
  });

  test("requires the existing authenticated operator", async () => {
    mocks.authorized.mockReturnValue(false);
    const response = await POST(request(), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="News Watch Fetch"');
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  test("does not reconcile a job without a known run ID", async () => {
    mocks.getJob.mockResolvedValue({ ...job, workflowRunId: null });
    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(mocks.getRun).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  test("does not release a job while its run is running or unverifiable", async () => {
    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      status: Promise.resolve("running"),
    });
    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(mocks.getSources).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();

    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(false),
      status: Promise.resolve("failed"),
    });
    const missingRun = await POST(request(), context);
    expect(missingRun.status).toBe(409);

    mocks.getRun.mockImplementation(() => {
      throw new Error("platform unavailable");
    });
    const unavailable = await POST(request(), context);
    expect(unavailable.status).toBe(503);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  test.each(["executing", "unknown"] as const)(
    "keeps a job held when a source side effect is %s",
    async (status) => {
      mocks.getSources.mockResolvedValue([{ sourceId: "qiita", status }]);
      const response = await POST(request(), context);

      expect(response.status).toBe(409);
      expect(mocks.revalidateTag).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );

  test("invalidates saved articles, then asks the repository to atomically reconcile", async () => {
    mocks.getSources.mockResolvedValue([
      { sourceId: "zenn", status: "saved" },
      { sourceId: "qiita", status: "pending" },
    ]);
    mocks.reconcile.mockResolvedValue({
      kind: "reconciled",
      status: "partial",
      invalidatedCount: 1,
      skippedCount: 1,
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.revalidateTag).toHaveBeenCalledWith("articles", { expire: 0 });
    expect(mocks.reconcile).toHaveBeenCalledWith("job-1", "wrun-1", "failed");
    expect(mocks.revalidateTag.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0],
    );
    expect(await response.json()).toEqual({
      status: "partial",
      invalidatedCount: 1,
      skippedCount: 1,
    });
  });

  test("does not issue another cache invalidation when no source needs it", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith("job-1", "wrun-1", "failed");
  });
});
