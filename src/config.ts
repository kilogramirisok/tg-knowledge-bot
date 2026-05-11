import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_API_ID: z.coerce.number().positive().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().default(''),
  TARGET_GROUP: z.string().default('taxesnomadspain'),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['google', 'openai']).default('google'),
  EMBEDDING_MODEL: z.string().default('text-embedding-004'),
  LLM_MODEL: z.string().default('gemini-2.0-flash'),
  DATABASE_PATH: z.string().default('./data/knowledge.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export function getMode(): string {
  const arg = process.argv.find(a => a.startsWith('--mode='));
  return arg?.split('=')[1] ?? 'all';
}
