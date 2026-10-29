import { readFile, writeFile } from "node:fs/promises";

const CONFIG_PATH = "src/app/.well-known/workflow/v1/config.json";
const PINNED_WORKFLOW_VERSION = "4.8.8";
const PINNED_STEP_MAX_DURATION_SECONDS = 300;

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (packageJson.dependencies?.workflow !== PINNED_WORKFLOW_VERSION) {
  throw new Error(
    `Expected workflow@${PINNED_WORKFLOW_VERSION}; found ${packageJson.dependencies?.workflow ?? "no direct dependency"}. Recheck generated step duration before changing this pin.`,
  );
}

let config;
try {
  config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
} catch (error) {
  throw new Error(`Expected generated Workflow config at ${CONFIG_PATH}`, {
    cause: error,
  });
}

if (!config.steps || typeof config.steps !== "object" || Array.isArray(config.steps)) {
  throw new Error(`Generated Workflow config has no steps settings: ${CONFIG_PATH}`);
}

const generatedDuration = config.steps.maxDuration;
if (generatedDuration !== "max" && generatedDuration !== PINNED_STEP_MAX_DURATION_SECONDS) {
  throw new Error(
    `Unexpected generated Workflow step maxDuration (${String(generatedDuration)}); expected "max" from workflow@${PINNED_WORKFLOW_VERSION}. Recheck the Vercel adapter before updating this pin.`,
  );
}

config.steps.maxDuration = PINNED_STEP_MAX_DURATION_SECONDS;
await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
