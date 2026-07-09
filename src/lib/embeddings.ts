import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");

/**
 * Generates an embedding for an article using Google's gemini-embedding-001 model.
 * 
 * @param title - The title of the article.
 * @param description - The description of the article (optional).
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export async function embedArticle(title: string, description: string | null): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

  const content = `${title}\n${description || ""}`.trim();

  const result = await model.embedContent({
    content: { role: "user", parts: [{ text: content }] },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });

  if (!result.embedding || !result.embedding.values) {
    throw new Error("Failed to generate embedding: No embedding values returned.");
  }

  return result.embedding.values;
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
 * Generates an embedding for a query using Google's gemini-embedding-001 model.
 * 
 * @param query - The search query.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
export async function embedQuery(query: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

  const result = await model.embedContent({
    content: { role: "user", parts: [{ text: query }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });

  if (!result.embedding || !result.embedding.values) {
    throw new Error("Failed to generate embedding: No embedding values returned.");
  }

  return result.embedding.values;
}
