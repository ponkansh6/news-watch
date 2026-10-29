# Gemini send-slot recovery

The shared send slot is normally released when the Gemini attempt is recorded as succeeded or failed. A process crash after an attempt starts leaves the result ambiguous; the repository counts that attempt conservatively in the 15-per-60-second ledger.

## Automatic recovery

Automatic recovery is allowed only for an owner whose database row contains all of:

- a recognized lease marker (`workflow-step-300-v1` or `request-60-v1`),
- a nonempty Vercel deployment ID, and
- a recovery deadline derived from the shared database clock at acquisition.

The Workflow marker is valid only while the build pin proves the generated Workflow step limit is 300 seconds. `scripts/pin-workflow-step-duration.mjs` checks the direct Workflow dependency and generated config, and fails the build if the expected generated value changes. The repository fences that owner after 360 seconds. A request marker may be used only by a call path whose Vercel route is explicitly capped at 60 seconds; its fence is 120 seconds. Callers without the matching proven context, without a deployment ID, or outside Vercel must create an `unknown` lease with no recovery deadline.

When a recognized deadline passes, the next claimant atomically marks any `started` attempt for that owner `ambiguous` at the database's current time, releases that exact owner, and applies the ordinary rolling 15/60 check before admitting a replacement. An owner that crashed before recording a `started` attempt has no send to count. This is bounded recovery: it does not retry or resend the uncertain request itself.

The same rule applies to the refresh-job single slot for a single-source request: only a `request-60-v1` owner with a deployment ID can be released, and only after its 120-second deadline (the declared 60-second route limit plus a 60-second margin). The release is conditional on the persisted owner/token generation, so an old request cannot release a newer owner's slot. Job owners and legacy or unknown slot owners are not reclaimed by age.

The safety argument assumes the recorded deployment used the build-time duration pin and that the shared database clock does not jump forward by more than the 60-second Workflow margin (or the 60-second request margin) relative to elapsed invocation time. The database clock supplies both acquisition and recovery timestamps; a large forward clock correction can shorten real elapsed time and invalidate the fence. Deployment IDs identify the build but do not independently prove its runtime behavior, so do not assign a recognized marker unless the matching build/context has been verified.

## Unknown or legacy owners

Owners with missing/unknown markers, no deployment ID, or no recovery deadline are never automatically reclaimed by age. This includes owners written by old deployments that predate the metadata columns and deployments whose build pin cannot be established. They remain occupied until the exact process or Workflow run is externally fenced. This fail-closed rule is required because multiple deployments and environments share the database.

Refresh-job reconciliation has a separate, bounded automatic path. A `/api/refresh-jobs` read or enqueue request makes one recovery attempt only when the held job is `needs_reconciliation`, has a known Workflow run ID, and Workflow reports that run as `completed`, `failed`, or `cancelled`. The job is finalized only if its source checkpoints are not `executing` or `unknown` and it has no candidate batch in `pending`, `running`, `result_ready`, or `unknown`. Saved article caches are revalidated and the job plus matching slot are conditionally reconciled atomically. Missing/unreadable/nonterminal runs, unsafe source checkpoints, and any unfinished candidate batch leave the slot held. This path neither repeats source work nor resubmits scoring. In particular, a terminal run with a `result_ready` batch is intentionally held for safe follow-up; automatic recovery does not yet resume that batch. An `enqueue_unknown` job without a Workflow run ID likewise cannot be recovered automatically. The authenticated operator reconcile endpoint remains available for eligible terminal runs, subject to the same checkpoint and unfinished-batch guards.

Use `getGeminiRateOwnerStatus()` to inspect the singleton owner ID, acquisition time, and any `started` attempt ID/time. It does not return the owner token or its hash. The database row alone cannot prove an unknown process is dead.

After externally fencing an unknown owner, call `releaseFencedGeminiOwner(ownerId, attemptId)` for an in-flight attempt. This records an ambiguous completion before releasing the matching owner in one database batch. For an owner with no started attempt, call it with `ownerId` only. Record the operator, owner ID, run ID, terminal evidence, and recovery time in the incident log; omit tokens, prompts, and response content. Never expose this operation on a public route.
