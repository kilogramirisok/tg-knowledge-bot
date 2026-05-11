/**
 * Vector similarity utilities.
 * Brute-force cosine similarity — sufficient for <100K vectors.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function findMostSimilar(
  query: number[],
  candidates: Array<{ id: number; embedding: number[] }>,
  options: { limit?: number; threshold?: number } = {},
): Array<{ id: number; similarity: number }> {
  const { limit = 5, threshold = 0 } = options;

  return candidates
    .map(c => ({ id: c.id, similarity: cosineSimilarity(query, c.embedding) }))
    .filter(r => r.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function serializeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

export function deserializeEmbedding(json: string | null): number[] {
  if (!json) return [];
  return JSON.parse(json) as number[];
}
