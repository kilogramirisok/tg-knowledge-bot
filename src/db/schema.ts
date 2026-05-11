import { sqliteTable, integer, text, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgUserId: integer('tg_user_id').unique().notNull(),
  username: text('username'),
  displayName: text('display_name'),
  reputationScore: real('reputation_score').default(0),
  messageCount: integer('message_count').default(0),
  answersGiven: integer('answers_given').default(0),
  reactionsReceived: integer('reactions_received').default(0),
  entriesCurated: integer('entries_curated').default(0),
  lastActiveAt: integer('last_active_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgMessageId: integer('tg_message_id').notNull(),
  userId: integer('user_id').references(() => users.id),
  chatId: integer('chat_id').notNull(),
  text: text('text'),
  replyToMessageId: integer('reply_to_message_id'),
  classification: text('classification', {
    enum: ['question', 'answer', 'discussion', 'noise'],
  }),
  qualityScore: real('quality_score'),
  embedding: text('embedding'), // JSON array of floats
  reactionsCount: integer('reactions_count').default(0),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('messages_chat_tg_idx').on(table.chatId, table.tgMessageId),
  index('messages_classification_idx').on(table.classification),
  index('messages_processed_idx').on(table.processedAt),
]);

export const knowledgeEntries = sqliteTable('knowledge_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  topicQuestion: text('topic_question').notNull(),
  bestAnswerText: text('best_answer_text').notNull(),
  confidenceScore: real('confidence_score').notNull(),
  sourceMessageIds: text('source_message_ids'), // JSON array of DB ids
  contributorUserIds: text('contributor_user_ids'), // JSON array of tg user ids
  tags: text('tags'), // JSON array of strings
  category: text('category'),
  embedding: text('embedding'), // JSON array of floats
  version: integer('version').default(1),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const userActivityLog = sqliteTable('user_activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id).notNull(),
  date: text('date').notNull(), // YYYY-MM-DD
  messageCount: integer('message_count').default(0),
  answersGiven: integer('answers_given').default(0),
  reactionsReceived: integer('reactions_received').default(0),
  entriesCurated: integer('entries_curated').default(0),
}, (table) => [
  index('activity_user_date_idx').on(table.userId, table.date),
]);
