import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNewsApiAuthorized: vi.fn(() => true),
  start: vi.fn(),
  startAggregateJob: vi.fn(),
  bindWorkflowRun: vi.fn(),
  markEnqueueUnknown: vi.fn(),
  markNeedsReconciliation: vi.fn(),
  getActiveRefreshSlot: vi.fn(),
  getOwnedRefreshJob: vi.fn(),
  getRefreshJobSources: vi.fn(),
}));

vi.mock("@/lib/news/api-auth", () => ({ isNewsApiAuthorized: mocks.isNewsApiAuthorized }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/workflows/aggregate-refresh", () => ({ aggregateRefreshWorkflow: vi.fn() }));
vi.mock("@/lib/db/repository/refresh-job-repository", () => ({
  startAggregateJob: mocks.startAggregateJob,
  bindWorkflowRun: mocks.bindWorkflowRun,
  markEnqueueUnknown: mocks.markEnqueueUnknown,
  markNeedsReconciliation: mocks.markNeedsReconciliation,
  getActiveRefreshSlot: mocks.getActiveRefreshSlot,
  getOwnedRefreshJob: mocks.getOwnedRefreshJob,
  getRefreshJobSources: mocks.getRefreshJobSources,
}));

import { GET, POST } from "@/app/api/refresh-jobs/route";
import { GET as GET_JOB } from "@/app/api/refresh-jobs/[jobId]/route";

const job = {
  id: "job-1",
  status: "running",
  revision: 2,
  currentSourceId: "zenn",
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:01.000Z",
  completedAt: null,
  nextEligibleAt: null,
  errorCode: null,
};
const source = {
  sourceId: "zenn",
  status: "pending",
  adapterStartedAt: null,
  savedAt: null,
  cacheInvalidatedAt: null,
  completedAt: null,
  resultCount: null,
  errorCode: null,
};

describe("refresh job APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNewsApiAuthorized.mockReturnValue(true);
    mocks.startAggregateJob.mockResolvedValue({
      kind: "created",
      job,
      executionToken: "secret-token",
    });
    mocks.start.mockResolvedValue({ runId: "run-1" });
    mocks.bindWorkflowRun.mockResolvedValue(true);
    mocks.markEnqueueUnknown.mockResolvedValue(true);
    mocks.markNeedsReconciliation.mockResolvedValue(true);
    mocks.getActiveRefreshSlot.mockResolvedValue({ ownerKind: "job", ownerId: job.id });
    mocks.getOwnedRefreshJob.mockResolvedValue(job);
    mocks.getRefreshJobSources.mockResolvedValue([source]);
  });

  test("starts one workflow and does not disclose its execution token", async () => {
    const response = await POST(
      new Request("https://news.test/api/refresh-jobs", { method: "POST" }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ jobId: job.id, status: "running", revision: job.revision });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.bindWorkflowRun).toHaveBeenCalledWith(job.id, "secret-token", "run-1");
  });

  test("joins the active aggregate job without starting another workflow", async () => {
    mocks.startAggregateJob.mockResolvedValue({ kind: "joined", job });
    const response = await POST(
      new Request("https://news.test/api/refresh-jobs", { method: "POST" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("returns a structured conflict when a single refresh owns the slot", async () => {
    mocks.startAggregateJob.mockResolvedValue({ kind: "busy", job: null });
    const response = await POST(
      new Request("https://news.test/api/refresh-jobs", { method: "POST" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "refresh already running", jobId: null });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("keeps an uncertain enqueue for reconciliation rather than retrying it", async () => {
    mocks.start.mockRejectedValue(new Error("enqueue outcome unknown"));
    mocks.getOwnedRefreshJob.mockResolvedValue({ ...job, status: "needs_reconciliation" });
    const response = await POST(
      new Request("https://news.test/api/refresh-jobs", { method: "POST" }),
    );

    expect(response.status).toBe(202);
    expect(mocks.markEnqueueUnknown).toHaveBeenCalledWith(job.id, "secret-token");
    expect(mocks.markNeedsReconciliation).toHaveBeenCalledWith(
      job.id,
      "secret-token",
      "enqueue_unknown",
    );
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  test("returns null when no aggregate job is active", async () => {
    mocks.getActiveRefreshSlot.mockResolvedValue({ ownerKind: "single", ownerId: "single:1" });
    const response = await GET(new Request("https://news.test/api/refresh-jobs"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: null });
  });

  test("returns only the shared owner's status and source checkpoints", async () => {
    const response = await GET_JOB(new Request("https://news.test/api/refresh-jobs/job-1"), {
      params: Promise.resolve({ jobId: job.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.job).toMatchObject({ jobId: job.id, status: job.status, sources: [source] });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(mocks.getOwnedRefreshJob).toHaveBeenCalledWith(job.id);
  });

  test("fails closed without auth", async () => {
    mocks.isNewsApiAuthorized.mockReturnValue(false);
    const response = await GET(new Request("https://news.test/api/refresh-jobs"));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="News Watch Fetch"');
    expect(mocks.getActiveRefreshSlot).not.toHaveBeenCalled();
  });

  test("uses the same Basic challenge for an unauthorized job lookup", async () => {
    mocks.isNewsApiAuthorized.mockReturnValue(false);
    const response = await GET_JOB(new Request("https://news.test/api/refresh-jobs/job-1"), {
      params: Promise.resolve({ jobId: job.id }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="News Watch Fetch"');
    expect(mocks.getOwnedRefreshJob).not.toHaveBeenCalled();
  });
});
