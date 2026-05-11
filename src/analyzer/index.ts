import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import { messages, knowledgeEntries, users } from '../db/schema.js';
import { eq, and, isNull, isNotNull, desc, sql } from 'drizzle-orm';
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
export async function processAllUnprocessed(db: DB, config: Config): Promise<void> {
  const unprocessed = db.select({
    id: messages.id,
    text: messages.text,
    userId: messages.userId,
    tgMessageId: messages.tgMessageId,
    replyToMessageId: messages.replyToMessageId,
    reactionsCount: messages.reactionsCount,
    tgUserId: users.tgUserId,
    username: users.username,
    displayName: users.displayName,
    reputationScore: users.reputationScore,
  })
    .from(messages)
    .leftJoin(users, eq(messages.userId, users.id))
    .where(and(
      isNull(messages.processedAt),
      isNotNull(messages.text),
      sql`length(${messages.text}) > 10`,
    ))
    .orderBy(messages.timestamp)
    .limit(50)
    .all();

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

async function processMessage(db: DB, msg: any, config: Config): Promise<void> {
  // Step 1: Classify
  const classification = await classifyMessage(msg.text, config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL);

  // Step 2: Update classification in DB
  db.update(messages)
    .set({ classification: classification.type })
    .where(eq(messages.id, msg.id))
    .run();

  // Step 3: Generate embedding
  let embedding: number[];
  try {
    embedding = await generateEmbedding(msg.text, config);
    db.update(messages)
      .set({ embedding: serializeEmbedding(embedding) })
      .where(eq(messages.id, msg.id))
      .run();
  } catch {
    console.log(chalk.yellow(`  [${msg.id}] Embedding failed, skipping dedup`));
    db.update(messages)
      .set({ processedAt: new Date() })
      .where(eq(messages.id, msg.id))
      .run();
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
    const reputation = await getReputationScore(db, msg.userId);

    // Composite score
    const finalScore = computeFinalScore(quality.overall, reputation, msg.reactionsCount);

    console.log(chalk.green(`    quality=${quality.overall.toFixed(2)} rep=${reputation.toFixed(2)} reactions=${msg.reactionsCount} final=${finalScore.toFixed(2)}`));

    if (finalScore >= 0.5) {
      if (dedup) {
        // Update existing entry if this is better
        if (finalScore > dedup.confidenceScore) {
          db.update(knowledgeEntries)
            .set({
              bestAnswerText: msg.text,
              confidenceScore: finalScore,
              sourceMessageIds: JSON.stringify([msg.tgMessageId]),
              contributorUserIds: JSON.stringify([msg.userId]),
              updatedAt: new Date(),
              version: sql`${knowledgeEntries.version} + 1`,
            })
            .where(eq(knowledgeEntries.id, dedup.id))
            .run();
          console.log(chalk.blue(`    → Updated KB entry #${dedup.id} (better score)`));
        } else {
          console.log(chalk.gray(`    → Duplicate of #${dedup.id}, lower score, skipped`));
        }
      } else {
        // New KB entry
        const topic = classification.topic ?? extractTopic(msg.text);
        db.insert(knowledgeEntries).values({
          topicQuestion: topic,
          bestAnswerText: msg.text,
          confidenceScore: finalScore,
          sourceMessageIds: JSON.stringify([msg.tgMessageId]),
          contributorUserIds: JSON.stringify([msg.userId]),
          tags: '',
          embedding: serializeEmbedding(embedding),
        }).run();
        console.log(chalk.green(`    → New KB entry: "${topic.substring(0, 50)}..."`));
      }
    } else {
      console.log(chalk.gray(`    → Score ${finalScore.toFixed(2)} below threshold 0.5, skipped`));
    }
  }

  // Mark as processed
  db.update(messages)
    .set({ processedAt: new Date() })
    .where(eq(messages.id, msg.id))
    .run();
}

function computeFinalScore(quality: number, reputation: number, reactions: number): number {
  // Normalize reactions (0-20 range → 0-1)
  const communitySignal = Math.min(reactions / 20, 1);
  return quality * 0.4 + reputation * 0.25 + communitySignal * 0.2 + 0.15;
}

async function findRelatedQuestion(db: DB, msg: any): Promise<string> {
  // If replying to a message, find that message
  if (msg.replyToMessageId) {
    const parent = db.select({ text: messages.text })
      .from(messages)
      .where(eq(messages.tgMessageId, msg.replyToMessageId))
      .get();
    if (parent?.text) return parent.text;
  }

  // Otherwise, find the most recent question before this message
  const recent = db.select({ text: messages.text })
    .from(messages)
    .where(and(
      eq(messages.classification, 'question'),
      sql`${messages.timestamp} < (SELECT ${messages.timestamp} FROM ${messages} WHERE ${messages.id} = ${msg.id})`,
    ))
    .orderBy(desc(messages.timestamp))
    .limit(1)
    .get();

  return recent?.text ?? 'General knowledge';
}

function extractTopic(text: string): string {
  // Take first sentence or first 80 chars as topic
  const firstSentence = text.split(/[.!?]/)[0] ?? text;
  return firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
}
