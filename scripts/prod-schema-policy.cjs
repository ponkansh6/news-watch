const SHARED_DATABASE_HOST = "news-watch-ponkansh.aws-ap-northeast-1.turso.io";

const SHARED_DATABASE_TABLES = new Set([
  "__drizzle_migrations_nordic",
  "answer_logs",
  "assisted_participants",
  "assisted_result_shares",
  "config",
  "discovery_host_metrics",
  "discovery_run",
  "discovery_seen",
  "evidence_signal_observations",
  "exam_answer_assessments",
  "exam_answer_logs",
  "exam_answer_submissions",
  "exam_participants",
  "exam_questions",
  "exam_submission_answers",
  "exam_submission_operations",
  "hatena_feeds",
  "host_gate_state",
  "knowledge",
  "nordic_articles",
  "nordic_job_state",
  "nordic_sources",
  "participant_rate_limits",
  "participant_result_settings",
  "post_publication_kind",
  "post_publications",
  "post_rationales",
  "post_removals",
  "post_retry_queue",
  "post_topics",
  "post_usefulness",
  "post_usefulness_criteria",
  "posts",
  "presentation_entries",
  "presentation_operations",
  "presentation_questions",
  "presentation_sessions",
  "questions",
  "source_policy",
  "topic_backfill_signatures",
]);

function findUndeclaredTables(actualTables, expectedTables, targetHost) {
  const expectedTableSet = new Set(expectedTables);
  return [...actualTables]
    .filter(
      (table) =>
        !expectedTableSet.has(table) &&
        !table.startsWith("sqlite_") &&
        table !== "__drizzle_migrations",
    )
    .filter((table) => targetHost !== SHARED_DATABASE_HOST || !SHARED_DATABASE_TABLES.has(table))
    .sort();
}

module.exports = { findUndeclaredTables };
