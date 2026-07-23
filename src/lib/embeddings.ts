import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

export const EMBEDDING_MODEL_VERSION = "gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 768;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

/**
 * Limit concurrent embedding requests.
 *
 * Google's embedding API rate-limits concurrent requests (returns 429). Firing
 * all article + keyword embeddings at once (e.g. 20 articles + 5 keywords in a
 * single scoring pipeline run) reliably trips that limit and, without backoff,
 * aborts the whole scoring run — which is why production scoring never
 * completed. A module-level semaphore caps in-flight requests, and each call is
 * retried with exponential backoff on transient failures.
 */
const MAX_CONCURRENT_EMBEDDINGS = 5;
const EMBED_MAX_RETRIES = 3;
const EMBED_BACKOFF_MS = 400;

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
 * Calculates the cosine similarity between two vectors.
 *
 * @param vecA - The first vector.
 * @param vecB - The second vector.
 * @returns The cosine similarity between the two vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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

const BATCH_SIZE = 100; // Google API batch limit

/**
 * Embed multiple texts in a single API call using batchEmbedContents.
 * Falls back to individual calls if batch fails.
 * Returns embeddings in the same order as the input items.
 */
export async function batchEmbed(items: BatchEmbedItem[]): Promise<number[][]> {
  if (items.length === 0) return [];

  const model = genAI.getGenerativeModel({ model: "gemini-embedding-2" });

  // Split into chunks of BATCH_SIZE
  const results: number[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);

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
