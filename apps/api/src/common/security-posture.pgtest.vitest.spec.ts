// security-posture.pgtest — Constitution 12 §270–271: the Security Center's encryption-health panel shows real state.
import { sourcePath } from '../../test-support/code-roots';
import { describe, it, expect, beforeAll } from 'vitest';
import { SecurityPosture } from './security-posture';
import { SecretRotation } from './secret-rotation';
import { SecurityEvents } from '@aipowersalon/security-center';
import { SecurityService } from '@aipowersalon/super-admin';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
const HEX = 'c'.repeat(64);

describe('the encryption-health panel is no longer a placeholder', () => {
  it('each key purpose is configured, on a fallback, or optional-and-unset — by name only', async () => {
    const p = new SecurityPosture(db); p.env = { MFA_ENC_KEY: HEX };
    const s = await p.snapshot();
    expect(s.keys.find((k) => k.env === 'MFA_ENC_KEY')?.state).toBe('configured');
    expect(s.keys.find((k) => k.env === 'PAYMENT_ENC_KEY')?.state).toBe('fallback');
    expect(s.keys.find((k) => k.env === 'APP_DATA_ENCRYPTION_KEY')?.state).toBe('optional_unset');
  });
  it('NO key, fingerprint or secret value ever appears in the snapshot', async () => {
    const p = new SecurityPosture(db); p.env = { MFA_ENC_KEY: HEX, AUTH_SESSION_SECRET: 'super-secret-session-value-123456' };
    const json = JSON.stringify(await p.snapshot());
    expect(json).not.toContain(HEX); expect(json).not.toContain('super-secret-session-value');
  });
  it('the last 24 h of security events are counted by severity and type', async () => {
    const ev = new SecurityEvents(db);
    await ev.record({ type: 'CROSS_TENANT_ACCESS_ATTEMPT', actorId: 'pp1' }); await ev.record({ type: 'CROSS_TENANT_ACCESS_ATTEMPT', actorId: 'pp2' }); await ev.record({ type: 'MFA_ENROLLED', actorId: 'pp3' });
    const s = await new SecurityPosture(db).snapshot();
    expect(s.events24h.total).toBeGreaterThanOrEqual(3);
    expect(s.events24h.topTypes.find((t) => t.type === 'CROSS_TENANT_ACCESS_ATTEMPT')!.count).toBeGreaterThanOrEqual(2);
    expect(s.events24h.bySeverity.HIGH).toBeGreaterThanOrEqual(2);
  });
  it('boot posture warnings surface on the panel (photos on container disk)', async () => {
    const p = new SecurityPosture(db); p.env = { DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/r' };
    expect((await p.snapshot()).posture.map((x) => x.variable)).toContain('MEDIA_STORE');
  });
  it('overdue rotation is listed by variable name', async () => {
    await pg.exec(`DELETE FROM secret_fingerprints; INSERT INTO secret_fingerprints (name, fingerprint, first_seen_at, last_seen_at) VALUES ('AUTH_SESSION_SECRET', 'abcd', now() - interval '400 days', now())`);
    const rot = new SecretRotation(db); rot.env = { AUTH_SESSION_SECRET: HEX };
    const p = new SecurityPosture(db, rot); p.env = { AUTH_SESSION_SECRET: HEX };
    expect((await p.snapshot()).rotationOverdue).toContain('AUTH_SESSION_SECRET');
  });
});

describe('wired into the EXISTING Security overview — not a second screen', () => {
  it('SecurityService fills encryptionHealth from the posture service when present, keeps the honest placeholder when not', async () => {
    const src = (await import('node:fs')).readFileSync(sourcePath('src/super-admin-security/security.service.ts'), 'utf8');
    expect(src).toMatch(/encryptionHealth: this\.posture \? await this\.posture\.snapshot\(\)/);
    expect(src).toMatch(/: \{ available: false, note: 'No encryption-health schema' \}/);
    expect(typeof SecurityService).toBe('function');
  });
});
