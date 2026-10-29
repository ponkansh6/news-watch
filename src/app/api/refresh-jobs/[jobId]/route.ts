import { NextResponse } from "next/server";
import {
  getOwnedRefreshJob,
  getRefreshJobSources,
} from "@/lib/db/repository/refresh-job-repository";
import { isNewsApiAuthorized } from "@/lib/news/api-auth";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
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
  const sources = await getRefreshJobSources(job.id);

  return NextResponse.json({
    job: {
      jobId: job.id,
      status: job.status,
      currentSourceId: job.currentSourceId,
      revision: job.revision,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      nextEligibleAt: job.nextEligibleAt,
      errorCode: job.errorCode,
      sources: sources.map((source) => ({
        sourceId: source.sourceId,
        status: source.status,
        adapterStartedAt: source.adapterStartedAt,
        savedAt: source.savedAt,
        cacheInvalidatedAt: source.cacheInvalidatedAt,
        completedAt: source.completedAt,
        resultCount: source.resultCount,
        errorCode: source.errorCode,
      })),
    },
  });
}
