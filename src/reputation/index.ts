import type { DB } from '../db/index.js';
import { users, messages } from '../db/schema.js';
import { eq, and, gte, count, sql } from 'drizzle-orm';
import { DEFAULT_REPUTATION_WEIGHTS } from '../types.js';

/**
 * Get reputation score for a single user (cached from DB).
 */
export async function getReputationScore(db: DB, userId: number | null): Promise<number> {
  if (!userId) return 0;
  const row = db.select({ reputationScore: users.reputationScore })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.reputationScore ?? 0;
}

export async function recalculateReputations(db: DB): Promise<void> {
  console.log('[reputation] Recalculating...');

  const allUsers = db.select({ id: users.id }).from(users).all();
  const now = new Date();
  const thirtyDaysAgo = Math.floor(now.getTime() / 1000) - 30 * 24 * 60 * 60;

  for (const user of allUsers) {
    const score = await calculateUserReputation(db, user.id, thirtyDaysAgo, now);
    db.update(users)
      .set({ reputationScore: score, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .run();
  }

  console.log(`[reputation] Updated ${allUsers.length} users`);
}

async function calculateUserReputation(
  db: DB,
  userId: number,
  sinceTimestamp: number,
  now: Date,
): Promise<number> {
  const w = DEFAULT_REPUTATION_WEIGHTS;

  const activityScore = await calcActivity(db, userId, sinceTimestamp);
  const expertiseScore = await calcExpertise(db, userId, sinceTimestamp);
  const curationScore = await calcCuration(db, userId);
  const recencyScore = await calcRecency(db, userId, now);

  return Math.min(Math.max(
    w.activity * activityScore +
    w.expertise * expertiseScore +
    w.curation * curationScore +
    w.recency * recencyScore,
  0), 1);
}

async function calcActivity(db: DB, userId: number, since: number): Promise<number> {
  const row = db.select({ count: count() })
    .from(messages)
    .where(and(
      eq(messages.userId, userId),
      gte(messages.timestamp, new Date(since * 1000)),
    ))
    .get();
  return Math.min((row?.count ?? 0) / 5, 1);
}

async function calcExpertise(db: DB, userId: number, since: number): Promise<number> {
  const row = db.select({ total: sql<number>`coalesce(sum(${messages.reactionsCount}), 0)` })
    .from(messages)
    .where(and(
      eq(messages.userId, userId),
      gte(messages.timestamp, new Date(since * 1000)),
      eq(messages.classification, 'answer'),
    ))
    .get();
  return Math.min((row?.total ?? 0) / 10, 1);
}

async function calcCuration(db: DB, userId: number): Promise<number> {
  const row = db.select({
    answersGiven: users.answersGiven,
    entriesCurated: users.entriesCurated,
  })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row || !row.answersGiven) return 0;
  return Math.min((row.entriesCurated ?? 0) / row.answersGiven, 1);
}

async function calcRecency(db: DB, userId: number, now: Date): Promise<number> {
  const row = db.select({ lastActiveAt: users.lastActiveAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row?.lastActiveAt) return 0;

  const ageDays = (now.getTime() - row.lastActiveAt.getTime()) / (1000 * 24 * 60 * 60);
  return Math.exp(-0.693 * ageDays / 7);
}
