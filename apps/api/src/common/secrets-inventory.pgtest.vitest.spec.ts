// secrets-inventory.pgtest — Constitution 12 §43–49: the inventory stays true; rotation is observed; nothing is committed.
import { codeRoots } from '../../test-support/code-roots';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { SECRETS, PUBLIC_RESTRICTED, NOT_SECRETS, SECRET_NAME_PATTERN } from './secrets-inventory';
import { SecretRotation, fingerprint } from './secret-rotation';
import { KEY_SOURCES } from './key-ring';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.ts$/.test(f) && !/spec|pgtest|\.d\.ts$/.test(f) ? [p] : []); });
const readEnvNames = (): Set<string> => {
  const names = new Set<string>();
  for (const f of codeRoots().flatMap((r) => walk(r))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:process\.env\.|process\.env\[['"]|\benv\.)([A-Z][A-Z0-9_]{3,})/g)) names.add(m[1]);
  }
  // The key ring reads its variables through a lookup table (env[KEY_SOURCES[p].env]) — invisible to a literal scan,
  // which is why my first run reported PAYMENT_ENC_KEY and TICKET_DELETION_ENC_KEY as "no longer read".
  for (const src of Object.values(KEY_SOURCES)) names.add(src.env);
  return names;
};

describe('§44 the inventory cannot go stale', () => {
  const read = readEnvNames();
  const listed = new Set(SECRETS.map((s) => s.env));
  it('every secret-shaped variable the API reads is listed (or reviewed as not-a-secret)', () => {
    const missing = [...read].filter((n) => SECRET_NAME_PATTERN.test(n) && !listed.has(n) && !NOT_SECRETS.has(n) && !n.endsWith('_PREVIOUS'));
    expect(missing, `add these to secrets-inventory.ts:\n${missing.join('\n')}`).toEqual([]);
  });
  it('every listed secret is still read somewhere — no stale entries', () => {
    const stale = [...listed].filter((n) => !read.has(n));
    expect(stale, `no code reads these any more — remove them:\n${stale.join('\n')}`).toEqual([]);
  });
  it('every key-ring purpose is inventoried with the same "required in production" as the boot check', () => {
    for (const src of Object.values(KEY_SOURCES)) {
      const e = SECRETS.find((s) => s.env === src.env);
      expect(e, src.env).toBeTruthy(); expect(!!e!.requiredInProduction).toBe(src.required);
    }
  });
  it('no entry is listed twice', () => expect(SECRETS.length).toBe(new Set(SECRETS.map((s) => s.env)).size));
});

describe('§47 nothing secret ships to a browser, nothing is committed', () => {
  it('the only VITE_ variable that is key-shaped is the reviewed, provider-restricted browser Maps key', () => {
    const root = join(process.cwd(), '../..');
    const out = execSync(`grep -rhoE "VITE_[A-Z0-9_]+" apps/*/src packages 2>/dev/null || true`, { cwd: root, encoding: 'utf8' });
    const keyish = [...new Set(out.split('\n').filter((n) => n && SECRET_NAME_PATTERN.test(n)))];
    expect(keyish).toEqual(PUBLIC_RESTRICTED.map((p) => p.env));
  });
  it('no .env file is tracked by git', () => {
    const tracked = execSync('git ls-files', { cwd: join(process.cwd(), '../..'), encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.(example|sample|template)$/.test(f))).toEqual([]);
  });
});

describe('§45 rotation is observed, never the value', () => {
  let pg: any; let db: any;
  beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
  beforeEach(async () => { await pg.exec('DELETE FROM secret_fingerprints'); });
  const HEX = 'a'.repeat(64), HEX2 = 'b'.repeat(64);
  const svc = (env: Record<string, string>, now = Date.parse('2026-09-22T00:00:00Z')) => { const s = new SecretRotation(db); s.env = env; s.now = () => now; return s; };

  it('first sight records a fingerprint — not the value — and NO rotation', async () => {
    expect(await svc({ MFA_ENC_KEY: HEX }).observe()).toEqual([]);
    const row = (await pg.query(`SELECT fingerprint, last_rotated_at FROM secret_fingerprints WHERE name = 'MFA_ENC_KEY'`)).rows[0];
    expect(row.fingerprint).toBe(fingerprint('MFA_ENC_KEY', HEX)); expect(row.fingerprint).toHaveLength(16);
    expect(row.fingerprint).not.toContain('aaaa'); expect(row.last_rotated_at).toBeNull();
  });
  it('a changed value is recorded as a rotation, with the date; an unchanged one is not', async () => {
    await svc({ MFA_ENC_KEY: HEX }).observe();
    expect(await svc({ MFA_ENC_KEY: HEX }).observe()).toEqual([]);
    expect(await svc({ MFA_ENC_KEY: HEX2 }, Date.parse('2026-10-01T00:00:00Z')).observe()).toEqual(['MFA_ENC_KEY']);
    expect((await pg.query(`SELECT last_rotated_at FROM secret_fingerprints WHERE name = 'MFA_ENC_KEY'`)).rows[0].last_rotated_at.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
  it('two instances booting with the new value record ONE rotation', async () => {
    await svc({ MFA_ENC_KEY: HEX }).observe();
    const [a, b] = await Promise.all([svc({ MFA_ENC_KEY: HEX2 }).observe(), svc({ MFA_ENC_KEY: HEX2 }).observe()]);
    expect([...a, ...b]).toEqual(['MFA_ENC_KEY']);
  });
  it('a low-entropy provider credential is NEVER fingerprinted (a short hash of a guessable value could be brute-forced)', async () => {
    await svc({ TWILIO_AUTH_TOKEN: 'password1', CARDPOINTE_PASSWORD: 'hunter2' }).observe();
    expect((await pg.query(`SELECT count(*)::int c FROM secret_fingerprints`)).rows[0].c).toBe(0);
  });
  it('rotationStatus: overdue once past policy; honest about unknown age; not-set and provider-issued said plainly', async () => {
    await svc({ AUTH_SESSION_SECRET: HEX }, Date.parse('2026-01-01T00:00:00Z')).observe();
    const st = await svc({ AUTH_SESSION_SECRET: HEX, TWILIO_AUTH_TOKEN: 'x' }, Date.parse('2026-09-22T00:00:00Z')).rotationStatus();
    const sess = st.find((s) => s.env === 'AUTH_SESSION_SECRET')!;
    expect(sess.overdue).toBe(true); expect(sess.note).toMatch(/never observed rotating.*real age is unknown/);
    expect(st.find((s) => s.env === 'TWILIO_AUTH_TOKEN')!.note).toMatch(/provider-issued/);
    expect(st.find((s) => s.env === 'PAYMENT_ENC_KEY')!).toMatchObject({ set: false, overdue: null, note: 'not set' });
  });
});
