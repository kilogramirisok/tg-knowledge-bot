import { generateText } from 'ai';
import type { AppDB } from '../db/index.js';
import type { Config } from '../config.js';
import { embedMessage } from '../analyzer/embed.js';
import { findSimilarEntries } from '../analyzer/dedup.js';
import chalk from 'chalk';

export async function startInteractiveQuery(db: AppDB, config: Config): Promise<void> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const apiKey = config.GOOGLE_GENERATIVE_AI_API_KEY ?? config.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ No LLM API key configured');
    process.exit(1);
  }

  console.log(chalk.cyan('\n🔍 Knowledge Base Query Interface'));
  console.log(chalk.gray('Type a question to search the KB. Commands: list, stats, exit\n'));

  const ask = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    const input = (await ask(chalk.yellow('> '))).trim();
    if (!input) continue;
    if (input === 'exit') break;
    if (input === 'list') { await listEntries(db); continue; }
    if (input === 'stats') { showStats(db); continue; }

    try {
      const answer = await queryKB(db, config, input, apiKey);
      console.log('\n' + chalk.green(answer) + '\n');
    } catch (err) {
      console.error(chalk.red('Error:'), err);
    }
  }

  rl.close();
}

export async function queryKB(
  db: AppDB,
  config: Config,
  question: string,
  apiKey: string,
): Promise<string> {
  const queryEmbedding = await embedMessage(
    question,
    config.EMBEDDING_PROVIDER as 'google' | 'openai',
    config.EMBEDDING_MODEL,
    apiKey,
  );

  if (queryEmbedding.length === 0) {
    return 'Unable to generate embedding for your question.';
  }

  const similarIds = await findSimilarEntries(db, queryEmbedding, 5);
  if (similarIds.length === 0) {
    return 'No relevant entries found in the knowledge base.';
  }

  const placeholders = similarIds.map(() => '?').join(',');
  const entries = db.raw.prepare(
    `SELECT * FROM knowledge_entries WHERE is_active = 1 AND id IN (${placeholders})`,
  ).all(...similarIds.map(s => s.id)) as Array<{
    id: number; topic_question: string; best_answer_text: string; confidence_score: number;
  }>;

  if (entries.length === 0) return 'No relevant entries found.';

  const { google } = await import('@ai-sdk/google');
  const model = config.GOOGLE_GENERATIVE_AI_API_KEY
    ? google(config.LLM_MODEL)
    : (await import('@ai-sdk/openai')).openai(config.LLM_MODEL);

  const context = entries
    .map((e, i) => `[${i + 1}] (confidence: ${e.confidence_score.toFixed(2)}) ${e.topic_question}\n${e.best_answer_text}`)
    .join('\n\n');

  const { text } = await generateText({
    model,
    prompt: `Answer this question based on the knowledge base entries below.
If the entries don't fully answer the question, say what's available and what's missing.
Cite confidence scores. Be concise and practical.

Question: ${question}

Knowledge Base Entries:
${context}`,
  });

  return text;
}

function listEntries(db: AppDB): void {
  const entries = db.raw.prepare(
    `SELECT id, topic_question, confidence_score, version, best_answer_text FROM knowledge_entries WHERE is_active = 1`,
  ).all() as Array<{ id: number; topic_question: string; confidence_score: number; version: number; best_answer_text: string }>;

  if (entries.length === 0) {
    console.log(chalk.gray('Knowledge base is empty.'));
    return;
  }

  console.log(chalk.cyan(`\n📚 ${entries.length} KB entries:\n`));
  for (const e of entries) {
    console.log(chalk.white(`  [${e.id}] ${e.topic_question}`));
    console.log(chalk.gray(`      confidence: ${e.confidence_score.toFixed(2)} | v${e.version}`));
    console.log(chalk.gray(`      ${e.best_answer_text.slice(0, 100)}...`));
    console.log();
  }
}

function showStats(db: AppDB): void {
  const msgCount = (db.raw.prepare(`SELECT COUNT(*) as cnt FROM messages`).get() as { cnt: number }).cnt;
  const kbCount = (db.raw.prepare(`SELECT COUNT(*) as cnt FROM knowledge_entries WHERE is_active = 1`).get() as { cnt: number }).cnt;
  const userCount = (db.raw.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number }).cnt;

  console.log(chalk.cyan('\n📊 Stats:'));
  console.log(`  Messages: ${msgCount}`);
  console.log(`  KB entries: ${kbCount}`);
  console.log(`  Users: ${userCount}`);
  console.log();
}
