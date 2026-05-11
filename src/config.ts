import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_API_ID: z.coerce.number().positive().optional(),
  TELEGRAM_API_HASH: z.string().optional(),
  TELEGRAM_SESSION: z.string().optional(),
  TARGET_GROUP: z.string().default('taxesnomadspain'),
  DATABASE_PATH: z.string().default('./data/knowledge.db'),
  LLM_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('google/gemini-2.0-flash-001'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

const VALID_MODES = ['seed', 'ingest', 'analyze', 'reputation', 'query', 'all'] as const;

export function getMode(): string {
  const args = process.argv;

  // Handle --mode=seed or --mode seed
  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      return arg.slice('--mode='.length);
    }
  }
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    return args[modeIdx + 1] ?? 'all';
  }
  // Shorthand: --seed, --analyze, etc.
  for (const arg of args) {
    if (arg.startsWith('--') && !arg.startsWith('--mode')) {
      const mode = arg.slice(2);
      if ((VALID_MODES as readonly string[]).includes(mode)) {
        return mode;
      }
    }
  }
  return 'all';
}

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
