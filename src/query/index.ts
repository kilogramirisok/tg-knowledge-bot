import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { AppDB } from '../db/index.js';
import type { Config } from '../config.js';
import { generateEmbedding } from '../analyzer/embed.js';
import { findSimilarEntries } from '../analyzer/dedup.js';
import chalk from 'chalk';

/**
 * Interactive query interface — search the KB from terminal.
 */
export async function startInteractiveQuery(db: AppDB, config: Config): Promise<void> {
  const openrouter = createOpenAI({
    baseURL: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
  });

  const rl = readline.createInterface({ input, output });

  console.log(chalk.cyan('\n🔍 Knowledge Base Query Interface'));
  console.log(chalk.gray('Type a question or "exit" to quit\n'));

  while (true) {
    const question = await rl.question(chalk.yellow('❓ '));
    if (!question.trim() || question.trim().toLowerCase() === 'exit') break;

    try {
      // Embed the question
      const queryEmbedding = await generateEmbedding(question, config);

      // Find similar KB entries
      const matches = findSimilarEntries(db, queryEmbedding, 0.5, 5);

      if (matches.length === 0) {
        console.log(chalk.gray('  No matching entries found.\n'));
        continue;
      }

      console.log(chalk.white(`  Found ${matches.length} related entries:\n`));

      for (const match of matches) {
        console.log(chalk.green(`  📋 ${match.topic_question}`));
        console.log(chalk.white(`     Score: ${match.confidence_score.toFixed(2)}`));
        console.log(chalk.gray(`     ${match.best_answer_text.substring(0, 120)}...`));
        console.log();
      }

      // Synthesize an answer with LLM
      const context = matches.map(m => `Q: ${m.topic_question}\nA: ${m.best_answer_text}`).join('\n\n');

      const { text: answer } = await generateText({
        model: openrouter(config.LLM_MODEL),
        prompt: `Answer this question based on the knowledge base entries below.
If the KB doesn't contain enough info, say so.

Question: ${question}

Knowledge Base:
${context}

Provide a concise, actionable answer:`,
      });

      console.log(chalk.cyan('  💡 Answer:'));
      console.log(chalk.white(`  ${answer}\n`));
    } catch (err) {
      console.error(chalk.red('  Error:'), err);
    }
  }

  rl.close();
}
