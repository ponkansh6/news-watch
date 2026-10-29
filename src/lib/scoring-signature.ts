import { createHash } from "node:crypto";
import { LLM_MODEL } from "./llm/client";
import { SCORING_PROMPT_VERSION } from "./constants";
import { BATCH_SCORING_BY_ID_PROMPT } from "./llm/prompts";

const SIGNATURE_HEX_LENGTH = 16;

/** sha256(`${title}\0${description ?? ""}`) の先頭16文字 */
export function computeContentHash(title: string, description: string | null): string {
  return createHash("sha256")
    .update(`${title}\0${description ?? ""}`)
    .digest("hex")
    .slice(0, SIGNATURE_HEX_LENGTH);
}

/** sha256(`v${SCORING_PROMPT_VERSION}\0${LLM_MODEL}\0${preferenceSection}`) の先頭16文字 */
export function computeScoringSignature(preferenceSection: string): string {
  return createHash("sha256")
    .update(`v${SCORING_PROMPT_VERSION}\0${LLM_MODEL}\0${preferenceSection}`)
    .digest("hex")
    .slice(0, SIGNATURE_HEX_LENGTH);
}

/**
 * Identified batch scores use a different response contract than the legacy
 * position-based scorer. Keep their cache namespace separate and include the
 * prompt text so edits invalidate prior results even if the global version is
 * accidentally left unchanged.
 */
export function computeIdentifiedScoringSignature(preferenceSection: string): string {
  return createHash("sha256")
    .update(
      `identified-v1\0v${SCORING_PROMPT_VERSION}\0${LLM_MODEL}\0${BATCH_SCORING_BY_ID_PROMPT}\0${preferenceSection}`,
    )
    .digest("hex")
    .slice(0, SIGNATURE_HEX_LENGTH);
}
