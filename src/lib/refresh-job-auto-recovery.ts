import { revalidateTag } from "next/cache";
import { getRun } from "workflow/api";
import {
  getActiveRefreshSlot,
  getOwnedRefreshJob,
  getRefreshJobSources,
} from "@/lib/db/repository/refresh-job-repository";
import { reconcileTerminalRefreshJob } from "@/lib/db/repository/refresh-job-recovery";

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

/** Makes one bounded attempt to release a verifiably terminal held job. */
export async function tryRecoverActiveRefreshJob(): Promise<boolean> {
  const slot = await getActiveRefreshSlot();
  if (slot?.ownerKind !== "job" || !slot.ownerId) return false;

  const job = await getOwnedRefreshJob(slot.ownerId);
  if (job?.status !== "needs_reconciliation" || !job.workflowRunId) return false;

  let runStatus: string;
  try {
    const run = getRun(job.workflowRunId);
    if (!(await run.exists)) return false;
    runStatus = await run.status;
  } catch {
    return false;
  }
  if (!terminalRunStatuses.has(runStatus)) return false;

  const sources = await getRefreshJobSources(job.id);
  if (
    sources.length === 0 ||
    sources.some((source) => source.status === "executing" || source.status === "unknown") ||
    sources.some((source) => !["pending", "saved", "invalidated", "failed"].includes(source.status))
  ) {
    return false;
  }

  if (sources.some((source) => source.status === "saved")) {
    revalidateTag("articles", { expire: 0 });
  }

  const result = await reconcileTerminalRefreshJob(
    job.id,
    job.workflowRunId,
    runStatus as "completed" | "failed" | "cancelled",
  );
  return result.kind === "reconciled";
}
