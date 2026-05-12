import { Redis } from 'ioredis';

export function createConnection(redisUrl: string) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
