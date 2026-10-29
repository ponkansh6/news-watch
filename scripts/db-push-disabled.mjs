console.error(
  "db:push is disabled: drizzle-kit push compares the full remote schema and may propose dropping tables absent from src/lib/db/schema.ts.",
);
console.error(
  "Generate and review an explicit additive SQL migration with `pnpm run db:generate`, verify the target, then use `pnpm run db:migrate` for a matching ledger or `pnpm run db:apply-additive -- <journal-migration-tag>` for a divergent ledger.",
);
process.exitCode = 1;
