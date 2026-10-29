import { revalidateTag } from "next/cache";
import { getRun } from "workflow/api";
import { NextResponse } from "next/server";
import {
  getOwnedRefreshJob,
  getRefreshJobSources,
} from "@/lib/db/repository/refresh-job-repository";
import { reconcileTerminalRefreshJob } from "@/lib/db/repository/refresh-job-recovery";
import { isNewsApiAuthorized } from "@/lib/news/api-auth";

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

/** Explicit operator action. The route only reconciles a known terminal run. */
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  if (!isNewsApiAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="News Watch Fetch"' },
      },
    );
  }

  const { jobId } = await context.params;
  const job = await getOwnedRefreshJob(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "needs_reconciliation" || !job.workflowRunId) {
    return NextResponse.json(
      { error: "Job has no safely verifiable Workflow run" },
      { status: 409 },
    );
  }

  let runStatus: string;
  try {
    const run = getRun(job.workflowRunId);
    if (!(await run.exists)) {
      return NextResponse.json({ error: "Workflow run could not be verified" }, { status: 409 });
    }
    runStatus = await run.status;
  } catch {
    return NextResponse.json({ error: "Workflow run could not be verified" }, { status: 503 });
  }
  if (!terminalRunStatuses.has(runStatus)) {
    return NextResponse.json({ error: "Workflow run is not terminal" }, { status: 409 });
  }

  const sources = await getRefreshJobSources(jobId);
  if (
    sources.length === 0 ||
    sources.some((source) => source.status === "executing" || source.status === "unknown") ||
    sources.some((source) => !["pending", "saved", "invalidated", "failed"].includes(source.status))
  ) {
    return NextResponse.json(
      { error: "Source checkpoints are not safe to reconcile" },
      { status: 409 },
    );
  }

  // Saved article writes only need cache invalidation; never fetch or score them again.
  if (sources.some((source) => source.status === "saved")) {
    revalidateTag("articles", { expire: 0 });
  }

  const result = await reconcileTerminalRefreshJob(
    jobId,
    job.workflowRunId,
    runStatus as "completed" | "failed" | "cancelled",
  );
  if (result.kind !== "reconciled") {
    return NextResponse.json(
      { error: "Refresh state changed or is unsafe to reconcile" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    status: result.status,
    invalidatedCount: result.invalidatedCount,
    skippedCount: result.skippedCount,
  });
}
