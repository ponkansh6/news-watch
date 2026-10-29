# Refresh job recovery

This runbook describes how to inspect a refresh that stays in `needs_reconciliation` or keeps the shared refresh slot occupied. The slot protects article writes from overlapping refreshes, so do not clear it because a job looks old or because a browser stopped polling.

## Read the current state

Use the authenticated status endpoints first:

- `GET /api/refresh-jobs` reports the current aggregate job, if one owns the slot.
- `GET /api/refresh-jobs/{jobId}` reports that job's source checkpoints and known Workflow run ID is intentionally not included in the public response.

The UI displays `needs_reconciliation` as an operator issue and does not start a replacement job. A shared-admin authenticated `POST /api/refresh-jobs/{jobId}/reconcile` operation can release a held aggregate slot only after it verifies a known Workflow run is terminal and the database still shows the same job/run/slot owner.

## If the Workflow run ID is known

Use the run ID recorded in the application database or Vercel Workflow run details. Inspect only the run metadata and event history; do not request decrypted payloads:

```sh
pnpm exec workflow inspect run <run-id> --backend=vercel --env=<preview-or-production> --project=<project-id> --team=<team-id> --json
pnpm exec workflow inspect steps --runId=<run-id> --backend=vercel --env=<preview-or-production> --project=<project-id> --team=<team-id> --json
pnpm exec workflow inspect events --runId=<run-id> --backend=vercel --env=<preview-or-production> --project=<project-id> --team=<team-id> --json
```

Do not add `--withData` or `--decrypt`. If Vercel reports the run as running, missing, or otherwise ambiguous, leave the slot held. A terminal Vercel state by itself is not enough to release the slot: compare it with each source checkpoint. `invalidated` and `failed` checkpoints are terminal. `saved` still requires cache invalidation. `executing` and `unknown` mean an external request may have completed without a recorded result, so never restart that source automatically.

When the run is terminal, make the explicit operator request:

```text
POST /api/refresh-jobs/{jobId}/reconcile
```

Make this request as an explicit administrative action using the application's existing authenticated API boundary. Do not wire it to a scheduled caller. The endpoint verifies the run again with the Vercel Workflow API, rechecks ownership and source checkpoints in an atomic database write, marks never-started `pending` sources failed, records terminal `failed`/`invalidated` sources, and releases only the matching job slot. If any source is `saved`, it first invalidates the article cache and records that checkpoint; it never fetches or scores that source again. The response contains only the terminal job status and counts.

The request returns a conflict without changing the slot if a source is `executing` or `unknown`, the job has no known run ID, ownership changed, or any checkpoint is inconsistent. Consistency includes valid, unique source IDs in the saved job snapshot and exact source ID/ordinal matches between that snapshot and its checkpoint rows. It intentionally does not compare against the current registry, which may have changed since the job was created. A Workflow API outage or lookup error also leaves the slot held. Failed or cancelled Workflow runs cannot produce a `completed` job, even when every source was invalidated; successful source checkpoints are classified as partial in that case. Do not issue direct SQL updates to the job or slot tables.

## If enqueue is uncertain and there is no run ID

Workflow SDK 4.8.8 generates the run ID inside `start()`, accepts no caller-provided idempotency key, and cannot find a run by the application's job ID. A missing run ID therefore cannot prove that enqueue failed. Check the Vercel project's Workflow runs and deployment timeline for a candidate run, then verify its ownership from the persisted run ID or trustworthy application logs. A candidate based only on a similar timestamp is not proof.

Until the run can be tied to the job, keep the slot held. Do not call the start endpoint again, release the slot by age, or retry the source. The current application provides no safe automatic way to resolve this case.

## If a single-source request was interrupted

The single-source API releases its slot in `finally`, but the process can stop before that runs. The singleton slot does not store a per-source checkpoint or a Workflow run ID for a single-source request. Check Vercel runtime logs and confirm the invocation has ended before asking for a reviewed recovery change. The current application cannot prove from the slot row alone that the article write stopped, so do not release this slot by age or by editing the database directly.

## Recovery boundary

Automatic recovery is safe only when the run is positively identified and terminal, ownership still matches, and all source side effects are either recorded as complete or can be resumed without repeating them. The application currently favors keeping an uncertain slot occupied over risking duplicate writes. A future operator recovery endpoint must enforce those conditions atomically, preserve the audit trail, and retry cache invalidation separately from article fetching and scoring.
