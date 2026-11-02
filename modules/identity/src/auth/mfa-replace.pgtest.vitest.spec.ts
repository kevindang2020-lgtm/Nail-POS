// mfa-replace.pgtest.vitest.spec.ts — Security Deep Scan C1 (P0), against the real schema: a session alone cannot replace
// a CONFIRMED authenticator (enroll answers 403 CURRENT_MFA_REQUIRED and records a HIGH security event); with the current
// code it can, and that code is single-use. A first-time enrollment needs no code.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MfaController } from './mfa.controller';
import { generateSecret, totpCode } from './totp';

const enc = { encrypt: (s: string) => 'e:' + s, decrypt: (s: string) => s.slice(2) } as any;
const T = '0f000000-0000-4000-8000-000000000001', U1 = '0f000000-0000-4000-8000-0000000000a1', U2 = '0f000000-0000-4000-8000-0000000000a2';
let db: any; const events: any[] = [];
beforeAll(async () => {
  const pg: any = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'M','M','mfa-r','MFAR')`, [T]);
  await pg.query(`insert into users (id, tenant_id, full_name, email, status, role, mfa_enabled, must_change_password) values ($1,$3,'Owner','o@mfa.test','active','OWNER',true,false),($2,$3,'New','n@mfa.test','active','OWNER',false,false)`, [U1, U2, T]);
}, 240000);
const ctl = () => new MfaController(db, enc, { record: async (e: any) => { events.push(e); } } as any);
const req = (userId: string) => ({ ctx: { userId, tenantId: T } });

describe('replacing an authenticator', () => {
  it('first enrollment needs no code', async () => {
    const r = await ctl().enroll(req(U2), {});
    expect(r.ok).toBe(true);
  });
  it('a confirmed factor cannot be replaced without its current code (403 + HIGH event); a wrong code also fails', async () => {
    const secret = generateSecret();
    await db.insertInto('mfa_factors').values({ user_id: U1, type: 'totp', secret_enc: enc.encrypt(secret), confirmed: true }).execute();
    await expect(ctl().enroll(req(U1), {})).rejects.toMatchObject({ status: 403 });
    await expect(ctl().enroll(req(U1), { currentCode: '000000' === totpCode(secret, Date.now()) ? '111111' : '000000' })).rejects.toMatchObject({ status: 403 });
    expect(events.some((e) => e.type === 'MFA_REPLACE_REFUSED' && e.actorId === U1)).toBe(true);
    const pending = await db.selectFrom('mfa_factors').select('id').where('user_id', '=', U1).where('confirmed', '=', false).execute();
    expect(pending).toHaveLength(0);
    const code = totpCode(secret, Date.now());
    const ok = await ctl().enroll(req(U1), { currentCode: code });
    expect(ok.ok).toBe(true);
    await expect(ctl().enroll(req(U1), { currentCode: code })).rejects.toMatchObject({ status: 403 });   // single-use
  });
});
