import type { AppDB } from '../db/index.js';
import { DEFAULT_REPUTATION_WEIGHTS } from '../types.js';

/**
 * Get reputation score for a single user (cached from DB).
 */
export async function getReputationScore(db: AppDB, userId: number | null): Promise<number> {
  if (!userId) return 0;
  const row = db.raw.prepare(
    `SELECT reputation_score FROM users WHERE id = ?`,
  ).get(userId) as { reputation_score: number } | undefined;
  return row?.reputation_score ?? 0;
}

export async function recalculateReputations(db: AppDB): Promise<void> {
  console.log('[reputation] Recalculating...');

  const allUsers = db.raw.prepare(`SELECT id FROM users`).all() as Array<{ id: number }>;
  const now = new Date();
  const thirtyDaysAgo = Math.floor(now.getTime() / 1000) - 30 * 24 * 60 * 60;

  for (const user of allUsers) {
    const score = await calculateUserReputation(db, user.id, thirtyDaysAgo, now);
    db.raw.prepare(`UPDATE users SET reputation_score = ?, updated_at = unixepoch() WHERE id = ?`)
      .run(score, user.id);
  }

  console.log(`[reputation] Updated ${allUsers.length} users`);
}

async function calculateUserReputation(
  db: AppDB,
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

async function calcActivity(db: AppDB, userId: number, since: number): Promise<number> {
  const row = db.raw.prepare(
    `SELECT COUNT(*) as cnt FROM messages WHERE user_id = ? AND timestamp >= ?`,
  ).get(userId, since) as { cnt: number } | undefined;
  return Math.min((row?.cnt ?? 0) / 5, 1);
}

async function calcExpertise(db: AppDB, userId: number, since: number): Promise<number> {
  const row = db.raw.prepare(
    `SELECT COALESCE(SUM(reactions_count), 0) as total FROM messages WHERE user_id = ? AND timestamp >= ? AND classification = 'answer'`,
  ).get(userId, since) as { total: number } | undefined;
  return Math.min((row?.total ?? 0) / 10, 1);
}

async function calcCuration(db: AppDB, userId: number): Promise<number> {
  const row = db.raw.prepare(
    `SELECT answers_given, entries_curated FROM users WHERE id = ?`,
  ).get(userId) as { answers_given: number; entries_curated: number } | undefined;
  if (!row || row.answers_given === 0) return 0;
  return Math.min(row.entries_curated / row.answers_given, 1);
}

async function calcRecency(db: AppDB, userId: number, now: Date): Promise<number> {
  const row = db.raw.prepare(
    `SELECT last_active_at FROM users WHERE id = ?`,
  ).get(userId) as { last_active_at: number | null } | undefined;
  if (!row?.last_active_at) return 0;

  const ageDays = (now.getTime() / 1000 - row.last_active_at) / (24 * 60 * 60);
  return Math.exp(-0.693 * ageDays / 7);
}
