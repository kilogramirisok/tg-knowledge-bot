import { generateObject } from 'ai';
import { z } from 'zod';
import type { AppDB } from '../db/index.js';
import type { Config } from '../config.js';
import { classifyMessage } from './classify.js';
import { embedMessage, storeEmbedding } from './embed.js';
import { checkDuplicate } from './dedup.js';
import { scoreQuality, calculateFinalScore, recencyScore } from './quality.js';
import { serializeEmbedding } from '../utils/vectors.js';
import { QUALITY_THRESHOLD } from '../types.js';

interface MessageRow {
  id: number;
  text: string | null;
  user_id: number | null;
  reactions_count: number;
  timestamp: number;
}

export async function processMessage(db: AppDB, config: Config, messageId: number): Promise<void> {
  const msg = db.raw.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as MessageRow | undefined;
  if (!msg || !msg.text) return;

  const apiKey = config.GOOGLE_GENERATIVE_AI_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('No API key — skipping analysis');
    return;
  }

  try {
    // Step 1: Classify
    const classification = await classifyMessage(
      msg.text,
      config.LLM_MODEL,
      config.GOOGLE_GENERATIVE_AI_API_KEY,
      config.OPENAI_API_KEY,
    );

    db.raw.prepare(`UPDATE messages SET classification = ?, processed_at = unixepoch() WHERE id = ?`)
      .run(classification.type, msg.id);

    // Step 2: Embed answers and questions
    if (classification.type === 'answer' || classification.type === 'question') {
      const embedding = await embedMessage(
        msg.text,
        config.EMBEDDING_PROVIDER as 'google' | 'openai',
        config.EMBEDDING_MODEL,
        apiKey,
      );
      if (embedding.length > 0) {
        storeEmbedding(db.raw, msg.id, embedding);
      }

      // Step 3: Process answers into KB
      if (classification.type === 'answer') {
        await processAnswer(db, config, msg, embedding, classification.topic, apiKey);
      }
    }

    console.log(`[analyze] msg ${msg.id} → ${classification.type}`);
  } catch (err) {
    console.error(`[analyze] msg ${msg.id} failed:`, err);
  }
}

async function processAnswer(
  db: AppDB,
  config: Config,
  msg: MessageRow,
  embedding: number[],
  topic: string | undefined,
  apiKey: string,
): Promise<void> {
  const quality = await scoreQuality(msg.text!, config.LLM_MODEL, config.GOOGLE_GENERATIVE_AI_API_KEY, config.OPENAI_API_KEY);

  db.raw.prepare(`UPDATE messages SET quality_score = ? WHERE id = ?`)
    .run(quality.overall, msg.id);

  // User reputation
  let userReputation = 0.5;
  if (msg.user_id) {
    const row = db.raw.prepare(`SELECT reputation_score FROM users WHERE id = ?`).get(msg.user_id) as { reputation_score: number } | undefined;
    if (row) userReputation = row.reputation_score ?? 0.5;
  }

  const communitySignal = Math.min((msg.reactions_count ?? 0) / 10, 1);
  const recency = recencyScore(new Date(msg.timestamp * 1000));
  const sourceDiversity = 0.5;

  const finalScore = calculateFinalScore({
    qualityScore: quality.overall,
    userReputation,
    communitySignal,
    recencyScore: recency,
    sourceDiversity,
  });

  console.log(`[score] msg ${msg.id}: quality=${quality.overall.toFixed(2)} rep=${userReputation.toFixed(2)} final=${finalScore.toFixed(2)}`);

  if (finalScore < QUALITY_THRESHOLD) {
    console.log(`[skip] msg ${msg.id}: score ${finalScore.toFixed(2)} below threshold`);
    return;
  }

  // Dedup check
  if (embedding.length > 0) {
    const dedup = await checkDuplicate(db, embedding);
    if (dedup.isDuplicate && dedup.similarEntryId) {
      if (dedup.shouldMerge) {
        const existing = db.raw.prepare(
          `SELECT id, confidence_score, source_message_ids, contributor_user_ids FROM knowledge_entries WHERE id = ?`,
        ).get(dedup.similarEntryId) as { id: number; confidence_score: number; source_message_ids: string | null; contributor_user_ids: string | null } | undefined;

        if (existing && finalScore > existing.confidence_score) {
          const srcIds = JSON.stringify([msg.id, ...JSON.parse(existing.source_message_ids ?? '[]') as number[]]);
          const contribIds = JSON.stringify([msg.user_id, ...JSON.parse(existing.contributor_user_ids ?? '[]') as number[]]);
          db.raw.prepare(
            `UPDATE knowledge_entries SET best_answer_text = ?, confidence_score = ?, source_message_ids = ?, contributor_user_ids = ?, updated_at = unixepoch() WHERE id = ?`,
          ).run(msg.text, finalScore, srcIds, contribIds, existing.id);
          console.log(`[merge] Updated KB entry ${existing.id}`);
        }
      }
      return;
    }
  }

  // New KB entry
  const topicQuestion = topic ?? 'General';
  db.raw.prepare(
    `INSERT INTO knowledge_entries (topic_question, best_answer_text, confidence_score, source_message_ids, contributor_user_ids, embedding, version, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, unixepoch(), unixepoch())`,
  ).run(
    topicQuestion,
    msg.text,
    finalScore,
    JSON.stringify([msg.id]),
    JSON.stringify(msg.user_id ? [msg.user_id] : []),
    serializeEmbedding(embedding),
  );

  console.log(`[kb] New entry for "${topicQuestion}" (score: ${finalScore.toFixed(2)})`);
}

export async function processAllUnprocessed(db: AppDB, config: Config): Promise<void> {
  const unprocessed = db.raw.prepare(
    `SELECT id FROM messages WHERE processed_at IS NULL LIMIT 50`,
  ).all() as Array<{ id: number }>;

  if (unprocessed.length === 0) {
    console.log('[analyze] No unprocessed messages');
    return;
  }

  console.log(`[analyze] Processing ${unprocessed.length} messages`);

  for (const msg of unprocessed) {
    await processMessage(db, config, msg.id);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('[analyze] Done');
}
