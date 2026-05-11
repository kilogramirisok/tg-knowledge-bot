import type { AppDB } from '../db/index.js';
import { cosineSimilarity, deserializeEmbedding } from '../utils/vectors.js';

interface KBEntry {
  id: number;
  topic_question: string;
  best_answer_text: string;
  confidence_score: number;
  embedding: string | null;
}

/**
 * Find the most similar KB entry above threshold.
 */
export async function findSimilarEntry(
  db: AppDB,
  queryEmbedding: number[],
  threshold: number = 0.85,
): Promise<KBEntry | null> {
  const entries = db.raw.prepare(
    `SELECT id, topic_question, best_answer_text, confidence_score, embedding FROM knowledge_entries WHERE is_active = 1 AND embedding IS NOT NULL`,
  ).all() as KBEntry[];

  let bestMatch: KBEntry | null = null;
  let bestSim = threshold;

  for (const entry of entries) {
    if (!entry.embedding) continue;
    try {
      const emb = deserializeEmbedding(entry.embedding);
      const sim = cosineSimilarity(queryEmbedding, emb);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry;
      }
    } catch {
      // Skip entries with corrupted embeddings
    }
  }

  return bestMatch;
}

/**
 * Find multiple similar KB entries (for query interface).
 */
export function findSimilarEntries(
  db: AppDB,
  queryEmbedding: number[],
  threshold: number = 0.3,
  limit: number = 5,
): KBEntry[] {
  const entries = db.raw.prepare(
    `SELECT id, topic_question, best_answer_text, confidence_score, embedding FROM knowledge_entries WHERE is_active = 1 AND embedding IS NOT NULL`,
  ).all() as KBEntry[];

  const scored = entries
    .map(entry => {
      if (!entry.embedding) return null;
      try {
        const emb = deserializeEmbedding(entry.embedding);
        return { entry, similarity: cosineSimilarity(queryEmbedding, emb) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { entry: KBEntry; similarity: number } => x !== null && x.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored.map(s => s.entry);
}
