import { describe, it, expect } from 'vitest';
import { isPrivateIp, safePost } from './ssrf';

describe('SSRF', () => {
  it('bloqueia redes internas, reservadas e IPv4 escondido em IPv6', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '198.18.0.5', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:172.16.0.1', '::ffff:100.64.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::169.254.169.254', '64:ff9b::a9fe:a9fe', 'ff02::1'])
      expect(isPrivateIp(ip), ip).toBe(true);
  });
  it('libera endereços públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '2001:4860:4860::8888']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('recusa conexão para IP interno, mesmo por nome que resolve para ele', async () => {
    await expect(safePost('http://127.0.0.1:9/x', {}, '{}', 2000)).rejects.toThrow(/bloqueado/);
    await expect(safePost('http://localhost:9/x', {}, '{}', 2000)).rejects.toThrow(/bloqueado/);
    await expect(safePost('http://[::ffff:127.0.0.1]:9/x', {}, '{}', 2000)).rejects.toThrow(/bloqueado/);
  });
});
