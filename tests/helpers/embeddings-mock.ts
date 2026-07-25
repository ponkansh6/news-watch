import { vi } from "vitest";
import { cosineSimilarity } from "@/lib/vector-math";
import { KEYWORDS } from "@/lib/config";

// Tokenise into lowercase words for overlap matching.
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s,v。．()（）]+/)
      .filter(Boolean),
  );
}

function createKeywordBases(count: number): number[][] {
  return Array.from({ length: count }, (_, k) => {
    const vec = new Array(768).fill(0);
    vec[k] = 1;
    return vec;
  });
}

function vectorFor(text: string): number[] {
  const textTokens = tokens(text);
  let bestIdx = -1;
  let bestOverlap = 0;
  for (let i = 0; i < KEYWORDS.length; i++) {
    const kwTokens = tokens(KEYWORDS[i]);
    let overlap = 0;
    for (const t of textTokens) {
      if (kwTokens.has(t)) overlap++;
    }
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  }
  if (bestOverlap > 0) return [...createKeywordBases(KEYWORDS.length)[bestIdx]];
  return new Array(768).fill(0);
}

export function createEmbeddingsMock() {
  let embedCallCount = 0;

  return {
    EMBEDDING_MODEL_VERSION: "gemini-embedding-2",
    EMBEDDING_DIMENSIONS: 768,
    cosineSimilarity,
    getEmbeddingRequestCount: () => embedCallCount,
    resetEmbeddingRequestCount: () => {
      embedCallCount = 0;
    },
    embedArticle: vi.fn(async (_title: string, _description: string | null) => {
      embedCallCount++;
      return vectorFor(`${_title}\n${_description || ""}`);
    }),
    embedQuery: vi.fn(async (query: string) => {
      embedCallCount++;
      return vectorFor(query);
    }),
    batchEmbed: vi.fn(async (items: { text: string }[]) => {
      embedCallCount++;
      return items.map((item) => vectorFor(item.text));
    }),
  };
}
