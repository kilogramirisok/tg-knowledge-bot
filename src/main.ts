import 'dotenv/config';
import { loadConfig, getMode } from './config.js';
import { createDB } from './db/index.js';
import { startIngestor } from './ingestor/index.js';
import { seedTestData } from './ingestor/seed.js';
import { processAllUnprocessed } from './analyzer/index.js';
import { recalculateReputations } from './reputation/index.js';
import { startInteractiveQuery } from './query/index.js';

async function main() {
  const config = loadConfig();
  const mode = getMode();

  console.log(`[main] Starting tg-knowledge-bot in ${mode} mode`);

  const db = createDB(config.DATABASE_PATH);

  // Create tables if they don't exist
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_user_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      display_name TEXT,
      reputation_score REAL DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      answers_given INTEGER DEFAULT 0,
      reactions_received INTEGER DEFAULT 0,
      entries_curated INTEGER DEFAULT 0,
      last_active_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_message_id INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id),
      chat_id INTEGER NOT NULL,
      text TEXT,
      reply_to_message_id INTEGER,
      classification TEXT CHECK(classification IN ('question', 'answer', 'discussion', 'noise')),
      quality_score REAL,
      embedding TEXT,
      reactions_count INTEGER DEFAULT 0,
      processed_at INTEGER,
      timestamp INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS messages_chat_tg_idx ON messages(chat_id, tg_message_id);
    CREATE INDEX IF NOT EXISTS messages_classification_idx ON messages(classification);
    CREATE INDEX IF NOT EXISTS messages_processed_idx ON messages(processed_at);
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_question TEXT NOT NULL,
      best_answer_text TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      source_message_ids TEXT,
      contributor_user_ids TEXT,
      tags TEXT,
      category TEXT,
      embedding TEXT,
      version INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS user_activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) NOT NULL,
      date TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      answers_given INTEGER DEFAULT 0,
      reactions_received INTEGER DEFAULT 0,
      entries_curated INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS activity_user_date_idx ON user_activity_log(user_id, date);
  `);

  try {
    switch (mode) {
      case 'seed':
        await seedTestData(db);
        break;
      case 'ingest':
        await startIngestor(db, config);
        break;
      case 'analyze':
        await processAllUnprocessed(db, config);
        break;
      case 'reputation':
        await recalculateReputations(db);
        break;
      case 'query':
        await startInteractiveQuery(db, config);
        break;
      case 'all': {
        const analyzerLoop = async () => {
          while (true) {
            try { await processAllUnprocessed(db, config); } catch (e) { console.error('[analyzer]', e); }
            await new Promise(r => setTimeout(r, 30000));
          }
        };
        const reputationLoop = async () => {
          while (true) {
            try { await recalculateReputations(db); } catch (e) { console.error('[reputation]', e); }
            await new Promise(r => setTimeout(r, 6 * 60 * 60 * 1000));
          }
        };
        await Promise.all([startIngestor(db, config), analyzerLoop(), reputationLoop()]);
        break;
      }
      default:
        console.error(`Unknown mode: ${mode}`);
        console.log('Modes: seed, ingest, analyze, reputation, query, all');
        process.exit(1);
    }
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  } finally {
    if (mode !== 'all' && mode !== 'ingest' && mode !== 'query') {
      db.close();
    }
  }
}

main();
