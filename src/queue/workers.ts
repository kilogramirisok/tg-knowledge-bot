import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import type { Queues } from './queues.js';
import type { ClassifyJob, EmbedJob, KBJob } from './jobs.js';
import { messages, knowledgeEntries } from '../db/schema.js';
import { eq, desc, and, sql } from 'drizzle-orm';
import { classifyMessage } from '../analyzer/classify.js';
import { generateEmbedding, serializeEmbedding } from '../analyzer/embed.js';
import { findSimilarEntry } from '../analyzer/dedup.js';
import { evaluateQuality } from '../analyzer/quality.js';
import { getReputationScore } from '../reputation/index.js';

export interface Workers {
  classifyWorker: Worker;
  embedWorker: Worker;
  kbWorker: Worker;
  close: () => Promise<void>;
}

export function createWorkers(
  db: DB,
  config: Config,
  connection: Redis,
  queues: Queues,
): Workers {
  // ── classify worker ──────────────────────────────────────────────────
  const classifyWorker = new Worker<ClassifyJob>(
    'classify',
    async (job) => {
      const { messageId, text } = job.data;

      const classification = await classifyMessage(
        text,
        config.LLM_BASE_URL,
        config.LLM_API_KEY,
        config.LLM_MODEL,
      );

      db.update(messages)
        .set({ classification: classification.type })
        .where(eq(messages.id, messageId))
        .run();

      console.log(
        `[worker:classify] msg ${messageId} → ${classification.type} (conf: ${classification.confidence.toFixed(2)})${classification.topic ? ' topic: ' + classification.topic : ''}`,
      );

      await queues.embed.add('embed', {
        messageId,
        text,
        classification: classification.type,
        topic: classification.topic,
        confidence: classification.confidence,
      });
    },
    {
      connection,
      concurrency: 3,
      limiter: { max: 10, duration: 1000 },
    },
  );

  classifyWorker.on('failed', (job, err) => {
    console.error(`[worker:classify] job ${job?.id} failed:`, err.message);
  });

  // ── embed worker ─────────────────────────────────────────────────────
  const embedWorker = new Worker<EmbedJob>(
    'embed',
    async (job) => {
      const { messageId, text, classification, topic, confidence } = job.data;

      let embedding: number[];
      try {
        embedding = await generateEmbedding(text, config);
      } catch {
        console.log(`[worker:embed] msg ${messageId} embedding failed, marking processed`);
        db.update(messages)
          .set({ processedAt: new Date() })
          .where(eq(messages.id, messageId))
          .run();
        return;
      }

      db.update(messages)
        .set({ embedding: serializeEmbedding(embedding) })
        .where(eq(messages.id, messageId))
        .run();

      console.log(`[worker:embed] msg ${messageId} embedded (${embedding.length} dims)`);

      if (classification === 'answer') {
        const row = db.select({
          userId: messages.userId,
          reactionsCount: messages.reactionsCount,
          tgMessageId: messages.tgMessageId,
        })
          .from(messages)
          .where(eq(messages.id, messageId))
          .get();

        await queues.kb.add('kb', {
          messageId,
          text,
          embedding,
          classification,
          topic,
          confidence,
          userId: row?.userId ?? null,
          reactionsCount: row?.reactionsCount ?? 0,
          tgMessageId: row?.tgMessageId ?? messageId,
        }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
      } else {
        db.update(messages)
          .set({ processedAt: new Date() })
          .where(eq(messages.id, messageId))
          .run();
        console.log(`[worker:embed] msg ${messageId} (${classification}) — done`);
      }
    },
    {
      connection,
      concurrency: 2,
    },
  );

  embedWorker.on('failed', (job, err) => {
    console.error(`[worker:embed] job ${job?.id} failed:`, err.message);
  });

  // ── kb worker ────────────────────────────────────────────────────────
  const kbWorker = new Worker<KBJob>(
    'kb',
    async (job) => {
      const {
        messageId, text, embedding, classification, topic, confidence,
        userId, reactionsCount, tgMessageId,
      } = job.data;

      const questionText = await findRelatedQuestion(db, messageId);
      const quality = await evaluateQuality(questionText, text, config);
      const dedup = await findSimilarEntry(db, embedding, 0.85);
      const reputation = await getReputationScore(db, userId);
      const finalScore = computeFinalScore(quality.overall, reputation, reactionsCount);

      console.log(
        `[worker:kb] msg ${messageId} quality=${quality.overall.toFixed(2)} rep=${reputation.toFixed(2)} reactions=${reactionsCount} final=${finalScore.toFixed(2)}`,
      );

      if (finalScore >= 0.5) {
        if (dedup) {
          if (finalScore > dedup.confidenceScore) {
            db.update(knowledgeEntries)
              .set({
                bestAnswerText: text,
                confidenceScore: finalScore,
                sourceMessageIds: JSON.stringify([tgMessageId]),
                contributorUserIds: JSON.stringify([userId]),
                updatedAt: new Date(),
                version: sql`${knowledgeEntries.version} + 1`,
              })
              .where(eq(knowledgeEntries.id, dedup.id))
              .run();
            console.log(`[worker:kb] → Updated KB entry #${dedup.id} (better score)`);
          } else {
            console.log(`[worker:kb] → Duplicate of #${dedup.id}, lower score, skipped`);
          }
        } else {
          const entryTopic = topic ?? extractTopic(text);
          db.insert(knowledgeEntries).values({
            topicQuestion: entryTopic,
            bestAnswerText: text,
            confidenceScore: finalScore,
            sourceMessageIds: JSON.stringify([tgMessageId]),
            contributorUserIds: JSON.stringify([userId]),
            tags: '',
            embedding: serializeEmbedding(embedding),
          }).run();
          console.log(`[worker:kb] → New KB entry: "${entryTopic.substring(0, 50)}..."`);
        }
      } else {
        console.log(`[worker:kb] → Score ${finalScore.toFixed(2)} below threshold 0.5, skipped`);
      }

      db.update(messages)
        .set({ processedAt: new Date() })
        .where(eq(messages.id, messageId))
        .run();
    },
    {
      connection,
      concurrency: 1,
    },
  );

  kbWorker.on('failed', (job, err) => {
    console.error(`[worker:kb] job ${job?.id} failed:`, err.message);
  });

  return {
    classifyWorker,
    embedWorker,
    kbWorker,
    close: async () => {
      await Promise.all([
        classifyWorker.close(),
        embedWorker.close(),
        kbWorker.close(),
      ]);
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

function computeFinalScore(quality: number, reputation: number, reactions: number): number {
  const communitySignal = Math.min(reactions / 20, 1);
  return quality * 0.4 + reputation * 0.25 + communitySignal * 0.2 + 0.15;
}

async function findRelatedQuestion(db: DB, messageId: number): Promise<string> {
  const msg = db.select({ replyToMessageId: messages.replyToMessageId })
    .from(messages)
    .where(eq(messages.id, messageId))
    .get();

  if (msg?.replyToMessageId) {
    const parent = db.select({ text: messages.text })
      .from(messages)
      .where(eq(messages.tgMessageId, msg.replyToMessageId))
      .get();
    if (parent?.text) return parent.text;
  }

  const recent = db.select({ text: messages.text })
    .from(messages)
    .where(and(
      eq(messages.classification, 'question'),
      sql`${messages.timestamp} < (SELECT ${messages.timestamp} FROM ${messages} WHERE ${messages.id} = ${messageId})`,
    ))
    .orderBy(desc(messages.timestamp))
    .limit(1)
    .get();

  return recent?.text ?? 'General knowledge';
}

function extractTopic(text: string): string {
  const firstSentence = text.split(/[.!?]/)[0] ?? text;
  return firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
}
