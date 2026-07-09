import { type ThresholdRecommendation } from "./threshold-eval";

export type ThresholdPolicy = "balanced" | "recall-first";

/**
 * Renders a SIMILARITY_THRESHOLD environment variable entry.
 *
 * @param threshold - The threshold value (0-1)
 * @returns Environment variable entry string
 */
export function renderThresholdEntry(threshold: number): string {
  return `SIMILARITY_THRESHOLD=${threshold.toFixed(2)}`;
}

/**
 * Upserts an environment variable in a .env file content.
 *
 * @param content - The current .env file content
 * @param key - The environment variable key to upsert
 * @param value - The value to set
 * @returns Updated .env file content
 */
export function upsertEnvVar(content: string, key: string, value: string): string {
  const linePattern = `^${key}=`;
  const newLine = `${key}=${value}`;
  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(linePattern)) {
      lines[i] = newLine;
      found = true;
      break;
    }
  }

  if (!found) {
    // Add to end, preserving trailing newline if present
    if (content.endsWith("\n")) {
      // Remove trailing empty line, add new line, then add back newline
      lines.pop(); // Remove empty line from trailing newline
      lines.push(newLine);
      lines.push(""); // Add back trailing newline
    } else {
      lines.push(newLine);
    }
  }

  return lines.join("\n");
}

/**
 * Selects a threshold based on recommendation and policy.
 *
 * @param rec - The threshold recommendation
 * @param policy - The selection policy
 * @returns The selected threshold value
 */
export function selectThreshold(rec: ThresholdRecommendation, policy: ThresholdPolicy): number {
  if (policy === "balanced") {
    return rec.maxF1Threshold;
  } else {
    // recall-first
    return rec.recallTargetThreshold ?? rec.maxF1Threshold;
  }
}
