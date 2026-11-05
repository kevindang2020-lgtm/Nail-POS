// network-posture.vitest.spec — Constitution 12 §50–55: configuration that defeats the private network is flagged.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkPosture } from './network-posture';

// Transport tests: media storage is configured (MEDIA_STORE=s3) so its own, separate finding stays out of these.
const P = (env: Record<string, string>) => networkPosture({ NODE_ENV: 'production', MEDIA_STORE: 's3', ...env });
describe('database transport', () => {
  it('Railway\'s private hostname is fine without sslmode', () => expect(P({ DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/railway' })).toEqual([]));
  it('a PUBLIC host without sslmode is flagged — credentials would cross the internet in the clear', () => {
    expect(P({ DATABASE_URL: 'postgresql://u:p@roundhouse.proxy.rlwy.net:41234/railway' })[0]).toMatchObject({ variable: 'DATABASE_URL' });
  });
  it('a public host WITH sslmode=require (an external managed database) is fine', () => {
    expect(P({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app?sslmode=require' })).toEqual([]);
  });
  it('sslmode=prefer does not count — it silently falls back to plaintext', () => {
    expect(P({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/app?sslmode=prefer' })).toHaveLength(1);
  });
});
describe('redis transport', () => {
  it('plain redis:// to a public host is flagged; rediss:// and private hosts are fine', () => {
    expect(P({ REDIS_URL: 'redis://default:p@redis.example.com:6379' })).toHaveLength(1);
    expect(P({ REDIS_URL: 'rediss://default:p@redis.example.com:6379' })).toEqual([]);
    expect(P({ REDIS_URL: 'redis://default:p@redis.railway.internal:6379' })).toEqual([]);
  });
});
describe('scope', () => {
  it('silent outside production (local Docker databases are plaintext by design)', () => {
    expect(networkPosture({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db.example.com/app' })).toEqual([]);
  });
  it('the finding names the variable, never the password', () => {
    expect(JSON.stringify(P({ DATABASE_URL: 'postgresql://u:s3cretPW@db.example.com/app' }))).not.toContain('s3cretPW');
  });
  it('main.ts runs it at boot', () => expect(readFileSync(join(process.cwd(), 'src/main.ts'), 'utf8')).toMatch(/for \(const f of networkPosture\(\)\)/));
});

describe('media durability (Constitution 12 Phase 16)', () => {
  const M = (env: Record<string, string>) => networkPosture({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/r', ...env });
  it('local-disk media in production is flagged — photos are lost on every deploy', () => {
    expect(M({})).toEqual([expect.objectContaining({ variable: 'MEDIA_STORE' })]);
  });
  it('S3, or local disk on a mounted volume (MEDIA_ROOT), is fine', () => {
    expect(M({ MEDIA_STORE: 's3' })).toEqual([]); expect(M({ MEDIA_ROOT: '/data/media' })).toEqual([]);
  });
});
