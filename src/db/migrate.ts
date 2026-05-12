import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DB } from './index.js';

export function runMigrations(db: DB): void {
  migrate(db, { migrationsFolder: './drizzle' });
}
