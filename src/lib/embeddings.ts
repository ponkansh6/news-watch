import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import {
  MAX_CONCURRENT_EMBEDDINGS,
  EMBED_MAX_RETRIES,
  EMBED_BACKOFF_MS,
  EMBED_BATCH_SIZE,
} from "./constants";

export const EMBEDDING_MODEL_VERSION = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

// --- Request counter (for monitoring & tests) ---
let embeddingRequestCount = 0;

/** Return the total number of embedding API calls since last reset. */
export function getEmbeddingRequestCount(): number {
  return embeddingRequestCount;
}

/** Reset the embedding request counter. */
export function resetEmbeddingRequestCount(): void {
  embeddingRequestCount = 0;
}

let activeEmbeddings = 0;
const embedWaiters: Array<() => void> = [];

function acquireEmbedSlot(): Promise<void> {
  if (activeEmbeddings < MAX_CONCURRENT_EMBEDDINGS) {
    activeEmbeddings++;
    return Promise.resolve();
  }
  return new Promise((resolve) => embedWaiters.push(resolve));
}

function releaseEmbedSlot(): void {
  activeEmbeddings--;
  const next = embedWaiters.shift();
  if (next) {
    activeEmbeddings++;
    next();
  }
}

async function embedWithRetry(embedFn: () => Promise<number[]>): Promise<number[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      return await embedFn();
    } catch (err) {
      lastError = err;
      if (attempt < EMBED_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, EMBED_BACKOFF_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function callEmbedding(taskType: TaskType, text: string): Promise<number[]> {
  await acquireEmbedSlot();
  try {
    return await embedWithRetry(async () => {
      embeddingRequestCount++;
      const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });
      const result = await model.embedContent({
        content: { role: "user", parts: [{ text }] },
        taskType,
      });

      if (!result.embedding || !result.embedding.values) {
        throw new Error("Failed to generate embedding: No embedding values returned.");
      }

      return result.embedding.values;
    });
  } finally {
    releaseEmbedSlot();
  }
}

/**
 * Generates an embedding for an article using Google's gemini-embedding-2 model.
 *
 * @param title - The title of the article.
 * @param description - The description of the article (optional).
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export async function embedArticle(title: string, description: string | null): Promise<number[]> {
  const content = `${title}\n${description || ""}`.trim();
  return callEmbedding(TaskType.RETRIEVAL_DOCUMENT, content);
}

/**
 * Generates an embedding for a query using Google's gemini-embedding-2 model.
 *
 * @param query - The search query.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export async function embedQuery(query: string): Promise<number[]> {
  return callEmbedding(TaskType.RETRIEVAL_QUERY, query);
}

// --- Batch embedding ---

interface BatchEmbedItem {
  text: string;
  taskType: TaskType;
}

/**
 * Embed multiple texts in a single API call using batchEmbedContents.
 * Falls back to individual calls if batch fails.
 * Returns embeddings in the same order as the input items.
 */
export async function batchEmbed(items: BatchEmbedItem[]): Promise<number[][]> {
  if (items.length === 0) return [];

  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

  // Split into chunks of EMBED_BATCH_SIZE
  const results: number[][] = [];
  for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
    const chunk = items.slice(i, i + EMBED_BATCH_SIZE);

    await acquireEmbedSlot();
    try {
      let lastError: unknown;
      let response: number[][] | null = null;
      for (let attempt = 0; attempt <= EMBED_MAX_RETRIES; attempt++) {
        try {
          embeddingRequestCount++;
          const res = await model.batchEmbedContents({
            requests: chunk.map((item) => ({
              content: { role: "user", parts: [{ text: item.text }] },
              taskType: item.taskType,
            })),
          });
          response = res.embeddings.map((e) => e.values);
          break;
        } catch (err) {
          lastError = err;
          if (attempt < EMBED_MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, EMBED_BACKOFF_MS * 2 ** attempt));
          }
        }
      }
      if (!response) throw lastError;
      results.push(...response);
    } catch {
      // Fallback: individual calls
      for (const item of chunk) {
        results.push(await callEmbedding(item.taskType, item.text));
      }
    } finally {
      releaseEmbedSlot();
    }
  }

  return results;
}
