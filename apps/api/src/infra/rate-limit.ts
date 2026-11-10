import { redis } from './redis';
import { AppError } from '../common/errors';

/** Janela fixa simples por chave (IP, CPF, e-mail, rota). Seções 5.3, 11.5, RN-16, RN-83. */
export async function hit(key: string, windowSec: number): Promise<number> {
  const k = `rl:${key}`;
  const n = await redis().incr(k);
  if (n === 1) await redis().expire(k, windowSec);
  return n;
}
export async function count(key: string): Promise<number> {
  return Number((await redis().get(`rl:${key}`)) || 0);
}
export async function limit(key: string, max: number, windowSec: number): Promise<void> {
  if ((await hit(key, windowSec)) > max) throw new AppError('RATE_LIMITED');
}
export async function isBlocked(key: string): Promise<boolean> { return (await redis().exists(`blk:${key}`)) === 1; }
export async function block(key: string, sec: number): Promise<void> { await redis().set(`blk:${key}`, '1', 'EX', sec); }
