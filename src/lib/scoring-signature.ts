import { createHash } from "node:crypto";
import { LLM_MODEL } from "./llm/client";
import { SCORING_PROMPT_VERSION } from "./constants";

/** sha256(`${title}\0${description ?? ""}`) の先頭16文字 */
export function computeContentHash(title: string, description: string | null): string {
  return createHash("sha256")
    .update(`${title}\0${description ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** sha256(`v${SCORING_PROMPT_VERSION}\0${LLM_MODEL}\0${preferenceSection}`) の先頭16文字 */
export function computeScoringSignature(preferenceSection: string): string {
  return createHash("sha256")
    .update(`v${SCORING_PROMPT_VERSION}\0${LLM_MODEL}\0${preferenceSection}`)
    .digest("hex")
    .slice(0, 16);
}
