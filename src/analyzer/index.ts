import type { AppDB } from '../db/index.js';
import type { Config } from '../config.js';
import { classifyMessage } from './classify.js';
import { generateEmbedding, serializeEmbedding } from './embed.js';
import { findSimilarEntry } from './dedup.js';
import { evaluateQuality } from './quality.js';
import { getReputationScore } from '../reputation/index.js';
import chalk from 'chalk';

/**
 * Process all unprocessed messages through the full pipeline:
 * classify → embed → dedup check → quality score → insert into KB
 */
export async function processAllUnprocessed(db: AppDB, config: Config): Promise<void> {
  const unprocessed = db.raw.prepare(
    `SELECT m.id, m.text, m.user_id, m.tg_message_id, m.reply_to_message_id, m.reactions_count,
            u.tg_user_id, u.username, u.display_name, u.reputation_score
     FROM messages m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.processed_at IS NULL AND m.text IS NOT NULL AND length(m.text) > 10
     ORDER BY m.timestamp ASC
     LIMIT 50`,
  ).all() as any[];

  if (unprocessed.length === 0) {
    console.log(chalk.gray('[analyzer] No unprocessed messages'));
    return;
  }

  console.log(chalk.cyan(`[analyzer] Processing ${unprocessed.length} messages...`));

  for (const msg of unprocessed) {
    try {
      await processMessage(db, msg, config);
    } catch (err) {
      console.error(chalk.red(`[analyzer] Failed msg ${msg.id}:`), err);
    }
  }
}

async function processMessage(db: AppDB, msg: any, config: Config): Promise<void> {
  // Step 1: Classify
  const classification = await classifyMessage(msg.text, config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL);

  // Step 2: Update classification in DB
  db.raw.prepare(
    `UPDATE messages SET classification = ? WHERE id = ?`,
  ).run(classification.type, msg.id);

  // Step 3: Generate embedding
  let embedding: number[];
  try {
    embedding = await generateEmbedding(msg.text, config);
    db.raw.prepare(`UPDATE messages SET embedding = ? WHERE id = ?`).run(serializeEmbedding(embedding), msg.id);
  } catch {
    console.log(chalk.yellow(`  [${msg.id}] Embedding failed, skipping dedup`));
    db.raw.prepare(`UPDATE messages SET processed_at = unixepoch() WHERE id = ?`).run(msg.id);
    return;
  }

  console.log(chalk.white(`  [${msg.id}] ${classification.type} (conf: ${classification.confidence.toFixed(2)}) ${classification.topic ?? ''}`));

  // Step 4: For answers, run quality + dedup → KB
  if (classification.type === 'answer') {
    // Find the question it answers (reply chain or recent question)
    const questionText = await findRelatedQuestion(db, msg);

    // Quality evaluation
    const quality = await evaluateQuality(questionText, msg.text, config);

    // Dedup check
    const dedup = await findSimilarEntry(db, embedding, 0.85);

    // Get user reputation
    const reputation = await getReputationScore(db, msg.user_id);

    // Composite score
    const finalScore = computeFinalScore(quality.overall, reputation, msg.reactions_count);

    console.log(chalk.green(`    quality=${quality.overall.toFixed(2)} rep=${reputation.toFixed(2)} reactions=${msg.reactions_count} final=${finalScore.toFixed(2)}`));

    if (finalScore >= 0.5) {
      if (dedup) {
        // Update existing entry if this is better
        if (finalScore > dedup.confidence_score) {
          db.raw.prepare(
            `UPDATE knowledge_entries
             SET best_answer_text = ?, confidence_score = ?, source_message_ids = ?,
                 contributor_user_ids = ?, updated_at = unixepoch(), version = version + 1
             WHERE id = ?`,
          ).run(
            msg.text,
            finalScore,
            JSON.stringify([msg.tg_message_id]),
            JSON.stringify([msg.user_id]),
            dedup.id,
          );
          console.log(chalk.blue(`    → Updated KB entry #${dedup.id} (better score)`));
        } else {
          console.log(chalk.gray(`    → Duplicate of #${dedup.id}, lower score, skipped`));
        }
      } else {
        // New KB entry
        const topic = classification.topic ?? extractTopic(msg.text);
        db.raw.prepare(
          `INSERT INTO knowledge_entries (topic_question, best_answer_text, confidence_score, source_message_ids, contributor_user_ids, tags, embedding, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
        ).run(
          topic,
          msg.text,
          finalScore,
          JSON.stringify([msg.tg_message_id]),
          JSON.stringify([msg.user_id]),
          '',
          serializeEmbedding(embedding),
        );
        console.log(chalk.green(`    → New KB entry: "${topic.substring(0, 50)}..."`));
      }
    } else {
      console.log(chalk.gray(`    → Score ${finalScore.toFixed(2)} below threshold 0.5, skipped`));
    }
  }

  // Mark as processed
  db.raw.prepare(`UPDATE messages SET processed_at = unixepoch() WHERE id = ?`).run(msg.id);
}

function computeFinalScore(quality: number, reputation: number, reactions: number): number {
  // Normalize reactions (0-20 range → 0-1)
  const communitySignal = Math.min(reactions / 20, 1);
  return quality * 0.4 + reputation * 0.25 + communitySignal * 0.2 + 0.15;
}

async function findRelatedQuestion(db: AppDB, msg: any): Promise<string> {
  // If replying to a message, find that message
  if (msg.reply_to_message_id) {
    const parent = db.raw.prepare(
      `SELECT text FROM messages WHERE tg_message_id = ?`,
    ).get(msg.reply_to_message_id) as { text: string } | undefined;
    if (parent?.text) return parent.text;
  }

  // Otherwise, find the most recent question before this message
  const recent = db.raw.prepare(
    `SELECT text FROM messages WHERE classification = 'question' AND timestamp < (SELECT timestamp FROM messages WHERE id = ?) ORDER BY timestamp DESC LIMIT 1`,
  ).get(msg.id) as { text: string } | undefined;

  return recent?.text ?? 'General knowledge';
}

function extractTopic(text: string): string {
  // Take first sentence or first 80 chars as topic
  const firstSentence = text.split(/[.!?]/)[0] ?? text;
  return firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
}
