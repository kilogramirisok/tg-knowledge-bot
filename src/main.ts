import 'dotenv/config';
import { loadConfig, getMode } from './config.js';
import { createDB } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { startIngestor } from './ingestor/index.js';
import { seedTestData } from './ingestor/seed.js';
import { processAllUnprocessed } from './analyzer/index.js';
import { recalculateReputations } from './reputation/index.js';
import { startInteractiveQuery } from './query/index.js';
import { startWorkers } from './queue/index.js';

async function main() {
  const config = loadConfig();
  const mode = getMode();

  console.log(`[main] Starting tg-knowledge-bot in ${mode} mode`);

  const { db, sqlite, close } = createDB(config.DATABASE_PATH);
  runMigrations(db);

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
      case 'worker':
        await startWorkers(db, config);
        break;
      case 'all': {
        const workers = await startWorkers(db, config);
        const reputationLoop = async () => {
          while (true) {
            try { await recalculateReputations(db); } catch (e) { console.error('[reputation]', e); }
            await new Promise(r => setTimeout(r, 6 * 60 * 60 * 1000));
          }
        };
        await Promise.all([startIngestor(db, config, workers), reputationLoop()]);
        await workers.close();
        break;
      }
      default:
        console.error(`Unknown mode: ${mode}`);
        console.log('Modes: seed, ingest, analyze, reputation, query, worker, all');
        process.exit(1);
    }
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  } finally {
    if (mode !== 'all' && mode !== 'ingest' && mode !== 'query' && mode !== 'worker') {
      close();
    }
  }
}

main();
