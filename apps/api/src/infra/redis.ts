import IORedis from 'ioredis';
let client: IORedis | null = null;
export function redis(): IORedis {
  if (!client) client = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  return client;
}
export function newRedis(): IORedis {
  return new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
}
