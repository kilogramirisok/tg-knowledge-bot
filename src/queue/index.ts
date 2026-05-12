import { createConnection } from './connection.js';
import { createQueues } from './queues.js';
import { createWorkers } from './workers.js';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';

export async function startWorkers(db: DB, config: Config) {
  const connection = createConnection(config.REDIS_URL);
  const queues = createQueues(connection);
  const workers = createWorkers(db, config, connection, queues);

  // Handle SIGTERM/SIGINT for graceful shutdown
  const shutdown = async () => {
    console.log('[queue] Shutting down workers...');
    await workers.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { ...workers, ...queues, connection, close: workers.close };
}
