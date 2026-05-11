import type { DB } from '../db/index.js';
import { knowledgeEntries } from '../db/schema.js';
import { eq, and, isNotNull } from 'drizzle-orm';
import { cosineSimilarity, deserializeEmbedding } from '../utils/vectors.js';

interface KBEntry {
  id: number;
  topicQuestion: string;
  bestAnswerText: string;
  confidenceScore: number;
  embedding: string | null;
}

/**
 * Find the most similar KB entry above threshold.
 */
export async function findSimilarEntry(
  db: DB,
  queryEmbedding: number[],
  threshold: number = 0.85,
): Promise<KBEntry | null> {
  const entries = db.select({
    id: knowledgeEntries.id,
    topicQuestion: knowledgeEntries.topicQuestion,
    bestAnswerText: knowledgeEntries.bestAnswerText,
    confidenceScore: knowledgeEntries.confidenceScore,
    embedding: knowledgeEntries.embedding,
  })
    .from(knowledgeEntries)
    .where(and(
      eq(knowledgeEntries.isActive, true),
      isNotNull(knowledgeEntries.embedding),
    ))
    .all();

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
  db: DB,
  queryEmbedding: number[],
  threshold: number = 0.3,
  limit: number = 5,
): KBEntry[] {
  const entries = db.select({
    id: knowledgeEntries.id,
    topicQuestion: knowledgeEntries.topicQuestion,
    bestAnswerText: knowledgeEntries.bestAnswerText,
    confidenceScore: knowledgeEntries.confidenceScore,
    embedding: knowledgeEntries.embedding,
  })
    .from(knowledgeEntries)
    .where(and(
      eq(knowledgeEntries.isActive, true),
      isNotNull(knowledgeEntries.embedding),
    ))
    .all();

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
