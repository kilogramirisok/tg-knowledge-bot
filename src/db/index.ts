import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AppDB {
  drizzle: ReturnType<typeof drizzle<typeof schema>>;
  raw: Database.Database;
  close: () => void;
}

export function createDB(dbPath: string): AppDB {
  mkdirSync(dirname(dbPath), { recursive: true });

  const raw = new Database(dbPath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const d = drizzle(raw, { schema });

  return {
    drizzle: d,
    raw,
    close: () => raw.close(),
  };
}
