import type { createClient } from "@libsql/client";

export function parseAdditiveMigration(sql: string): Promise<string[]>;
export function parseMigrationTagArgument(args: string[]): string;

export function applyAdditiveStatements(
  client: ReturnType<typeof createClient>,
  statements: string[],
): Promise<void>;
