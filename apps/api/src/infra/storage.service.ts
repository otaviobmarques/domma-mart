import { Injectable } from '@nestjs/common';
import { mkdirSync, existsSync, statSync, createReadStream, appendFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { signToken, verifyToken } from '../common/crypto';

/**
 * Armazenamento de arquivos. Driver local para desenvolvimento; em produção trocar por
 * Cloudflare R2/S3 com URLs pré-assinadas (mesma interface). Documentos KYC usam prefixo
 * "kyc/" — em produção, bucket separado e criptografado (seção 6.1).
 */
@Injectable()
export class StorageService {
  private root = resolve(process.env.STORAGE_DIR || './storage');

  path(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('invalid key');
    return p;
  }
  write(key: string, data: Buffer, append = false) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    append ? appendFileSync(p, data) : writeFileSync(p, data);
  }
  exists(key: string) { return existsSync(this.path(key)); }
  size(key: string) { return statSync(this.path(key)).size; }
  stream(key: string, range?: { start: number; end: number }) { return createReadStream(this.path(key), range); }

  /** URL assinada e temporária (RN-91: vídeo 2 h, anexos 15 min; KYC 5 min). */
  signedUrl(key: string, ttlSec: number, extra: Record<string, unknown> = {}): string {
    const t = signToken({ k: key, exp: Date.now() + ttlSec * 1000, ...extra });
    return `/v1/files/${t}`;
  }
  resolveSigned(token: string): { k: string; nocache?: boolean } | null {
    return verifyToken<{ k: string; nocache?: boolean }>(token);
  }
}
export const _join = join;
