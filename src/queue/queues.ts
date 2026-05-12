import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export function createQueues(connection: Redis) {
  return {
    classify: new Queue('classify', { connection }),
    embed: new Queue('embed', { connection }),
    kb: new Queue('kb', { connection }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
