// password-scope.pgtest.vitest.spec.ts — one technician, one password. And the door that had to stay shut.
//
// == WHY THIS IS NOT A WEAKENING ==========================================================================
//
// The per-salon password looked like isolation. It never was: `POST /tech/context/switch` already re-mints her
// session for any salon she is actively employed at, and cross-salon Face ID does the same. One authentication
// already reached all of them. The second password bought ZERO isolation and cost her a second password.
//
// == AND THE DOOR ========================================================================================
//
// Making the password propagate opens one, and the whole second half of this file is about keeping it shut:
//
//     if accepting an invitation could SET her password, then anyone holding an invite link for a new salon
//     could choose a password that ROTATED HER CREDENTIAL at the salons she already works at.
//
// An invitation is an offer of employment. It is not a password reset. So accept VERIFIES against the password
// she already has and reuses that hash — it never overwrites it.
import { KyselySuperAdminPlatformRepo } from '@aipowersalon/super-admin';
import { mintInvitationToken, invitationExpiry } from '@aipowersalon/identity';
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { existingTechnicianPasswordHash, propagateTechnicianPassword, technicianPasswordPeers } from '@aipowersalon/identity';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(q: any) {
        const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]);
        return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) };
      },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const LUXE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BELLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BR_L = 'a1111111-1111-1111-1111-111111111111';
const BR_B = 'b1111111-1111-1111-1111-111111111111';

const HER_PASSWORD = 'olivia-real-password-1';
const AN_ATTACKERS_CHOICE = 'attacker-chosen-password-9';

let pg: PGlite;
let db: any;
let platform: KyselySuperAdminPlatformRepo;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

async function profile(code: string, status = 'active') {
  const r: any = (await q(`insert into global_tech_profiles (tech_code, public_slug, display_name, status)
                           values ($1,$2,'Olivia Brown',$3) returning id`, [code, `${code.toLowerCase()}-s`, status]))[0];
  return String(r.id);
}
async function login(tenant: string, branch: string, profileId: string | null, status = 'active', role = 'TECHNICIAN', hash: string | null = null) {
  const r: any = (await q(`insert into users (tenant_id, branch_id, role, status, full_name, password_hash, global_tech_profile_id)
                           values ($1,$2,$3,$4,'Olivia Brown',$5,$6) returning id`, [tenant, branch, role, status, hash, profileId]))[0];
  return String(r.id);
}
const hashOf = (id: string) => q(`select password_hash from users where id = $1`, [id]).then((r: any) => r[0].password_hash);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* pg_trgm */ }
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  platform = new KyselySuperAdminPlatformRepo(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
             ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle Palace','belle','BELLE','active')`, [LUXE, BELLE]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'M','active'), ($3,$4,'M','active')`, [BR_L, LUXE, BR_B, BELLE]);
}, 180000);

describe('ONE technician, ONE password', () => {
  it('changing it at Luxe changes it at Belle — it is her password, not the salon’s', async () => {
    const p = await profile('TECH-700001');
    const atLuxe = await login(LUXE, BR_L, p, 'active', 'TECHNICIAN', await hashPassword('old-password-aaa'));
    const atBelle = await login(BELLE, BR_B, p, 'active', 'TECHNICIAN', await hashPassword('old-password-aaa'));

    const fresh = await hashPassword('brand-new-password-1');
    const reached = await propagateTechnicianPassword(db, atLuxe, fresh);

    expect(reached).toBe(1);
    expect(await verifyPassword('brand-new-password-1', await hashOf(atBelle))).toBe(true);
  });

  it('an INVITED peer does not receive it — a password must not quietly become a working login', async () => {
    const p = await profile('TECH-700002');
    const atLuxe = await login(LUXE, BR_L, p, 'active');
    const invitedAtBelle = await login(BELLE, BR_B, p, 'invited');

    expect(await technicianPasswordPeers(db, atLuxe)).toEqual([]);
    expect(await propagateTechnicianPassword(db, atLuxe, await hashPassword('x-y-z-1234567'))).toBe(0);
    expect(await hashOf(invitedAtBelle)).toBeNull();
  });

  it('a SUSPENDED platform account propagates nowhere', async () => {
    const p = await profile('TECH-700003', 'suspended');
    const atLuxe = await login(LUXE, BR_L, p);
    await login(BELLE, BR_B, p);
    expect(await propagateTechnicianPassword(db, atLuxe, await hashPassword('x-y-z-1234567'))).toBe(0);
  });

  it('a MANAGER’s password goes nowhere — this is a technician rule, not a global one', async () => {
    const mgrLuxe = await login(LUXE, BR_L, null, 'active', 'MANAGER');
    await login(BELLE, BR_B, null, 'active', 'MANAGER');
    expect(await propagateTechnicianPassword(db, mgrLuxe, await hashPassword('x-y-z-1234567'))).toBe(0);
  });

  it('two UNLINKED technicians never share anything', async () => {
    const one = await login(LUXE, BR_L, await profile('TECH-700004'));
    const two = await login(BELLE, BR_B, await profile('TECH-700005'), 'active', 'TECHNICIAN', await hashPassword('her-own-password-2'));
    expect(await propagateTechnicianPassword(db, one, await hashPassword('x-y-z-1234567'))).toBe(0);
    expect(await verifyPassword('her-own-password-2', await hashOf(two))).toBe(true);
  });
});

describe('AN INVITATION IS NOT A PASSWORD RESET', () => {
  /** Belle invites her; the invitation names the users row it activates (migration 380). */
  async function inviteHerToBelle(profileId: string) {
    const invitedRow = await login(BELLE, BR_B, profileId, 'invited');
    const { token, tokenHash, tokenPrefix } = mintInvitationToken();
    await q(`insert into user_invitations (tenant_id, branch_id, normalized_phone, role, user_id, token_hash, token_prefix, delivery_channel, expires_at)
             values ($1,$2,'+18565550001','TECHNICIAN',$3,$4,$5,'sms',$6)`,
      [BELLE, BR_B, invitedRow, tokenHash, tokenPrefix, invitationExpiry()]);
    return { token, invitedRow };
  }

  it('THE ESCALATION: an invite link CANNOT rotate the password at the salon she already works at', async () => {
    // This is the door. If accept could SET her password, whoever holds her Belle invite link — a manager, a
    // colleague who saw her phone, anyone the text was forwarded to — could pick a password and take over her
    // LUXE login with it. An offer of employment must not be a credential-reset primitive.
    const p = await profile('TECH-700010');
    const atLuxe = await login(LUXE, BR_L, p, 'active', 'TECHNICIAN', await hashPassword(HER_PASSWORD));
    const luxeHashBefore = await hashOf(atLuxe);

    const { token, invitedRow } = await inviteHerToBelle(p);

    const out: any = await platform.acceptInvitation({ token, password: AN_ATTACKERS_CHOICE });

    expect(out.ok).toBe(false);
    expect(out.reason).toBe('existing_account_password');

    // her Luxe password is EXACTLY as it was
    expect(await hashOf(atLuxe)).toBe(luxeHashBefore);
    expect(await verifyPassword(HER_PASSWORD, await hashOf(atLuxe))).toBe(true);
    expect(await verifyPassword(AN_ATTACKERS_CHOICE, await hashOf(atLuxe))).toBe(false);

    // and Belle was NOT activated
    const [belle]: any = await q(`select status, password_hash from users where id = $1`, [invitedRow]);
    expect(belle.status).toBe('invited');
    expect(belle.password_hash).toBeNull();
  });

  it('she accepts with the password she ALREADY HAS — and it is the same hash, not a new one', async () => {
    const p = await profile('TECH-700011');
    const atLuxe = await login(LUXE, BR_L, p, 'active', 'TECHNICIAN', await hashPassword(HER_PASSWORD));
    const luxeHash = await hashOf(atLuxe);

    const { token, invitedRow } = await inviteHerToBelle(p);

    const out: any = await platform.acceptInvitation({ token, password: HER_PASSWORD });
    expect(out.ok).toBe(true);

    const [belle]: any = await q(`select status, password_hash, global_tech_profile_id from users where id = $1`, [invitedRow]);
    expect(belle.status).toBe('active');
    expect(belle.password_hash).toBe(luxeHash);            // the SAME hash — one password, not a second one
    expect(String(belle.global_tech_profile_id)).toBe(p);  // still her account
    expect(await hashOf(atLuxe)).toBe(luxeHash);           // and Luxe is untouched
  });

  it('her FIRST salon still just sets a password, exactly as before', async () => {
    const p = await profile('TECH-700012');
    const { token, invitedRow } = await inviteHerToBelle(p);   // no peer anywhere

    const out: any = await platform.acceptInvitation({ token, password: 'a-first-password-11' });
    expect(out.ok).toBe(true);
    expect(await verifyPassword('a-first-password-11', await hashOf(invitedRow))).toBe(true);
  });

  it('existingTechnicianPasswordHash returns null when she has no other salon', async () => {
    const solo = await login(LUXE, BR_L, await profile('TECH-700013'), 'active', 'TECHNICIAN', await hashPassword('solo-password-123'));
    expect(await existingTechnicianPasswordHash(db, solo)).toBeNull();
  });
});
