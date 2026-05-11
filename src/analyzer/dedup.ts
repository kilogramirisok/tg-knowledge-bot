import type { AppDB } from '../db/index.js';
import { knowledgeEntries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { findMostSimilar, deserializeEmbedding } from '../utils/vectors.js';
import type { DedupResult } from '../types.js';
import { DEDUP_SIMILARITY_THRESHOLD } from '../types.js';

export async function checkDuplicate(db: AppDB, newEmbedding: number[]): Promise<DedupResult> {
  if (newEmbedding.length === 0) {
    return { isDuplicate: false, similarity: 0, shouldMerge: false };
  }

  const entries = db.raw.prepare(
    `SELECT id, embedding FROM knowledge_entries WHERE is_active = 1`,
  ).all() as Array<{ id: number; embedding: string | null }>;

  if (entries.length === 0) {
    return { isDuplicate: false, similarity: 0, shouldMerge: false };
  }

  const candidates = entries
    .map(e => ({ id: e.id, embedding: deserializeEmbedding(e.embedding) }))
    .filter(c => c.embedding.length > 0);

  const matches = findMostSimilar(newEmbedding, candidates, { limit: 1, threshold: DEDUP_SIMILARITY_THRESHOLD });

  if (matches.length === 0) {
    return { isDuplicate: false, similarity: 0, shouldMerge: false };
  }

  const best = matches[0]!;
  return {
    isDuplicate: true,
    similarEntryId: best.id,
    similarity: best.similarity,
    shouldMerge: best.similarity > 0.92,
  };
}

export async function findSimilarEntries(
  db: AppDB,
  queryEmbedding: number[],
  limit: number = 5,
): Promise<Array<{ id: number; similarity: number }>> {
  const entries = db.raw.prepare(
    `SELECT id, embedding FROM knowledge_entries WHERE is_active = 1`,
  ).all() as Array<{ id: number; embedding: string | null }>;

  const candidates = entries
    .map(e => ({ id: e.id, embedding: deserializeEmbedding(e.embedding) }))
    .filter(c => c.embedding.length > 0);

  return findMostSimilar(queryEmbedding, candidates, { limit, threshold: 0.5 });
}
