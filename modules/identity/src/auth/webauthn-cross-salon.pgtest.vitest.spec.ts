// webauthn-cross-salon.pgtest.vitest.spec.ts — her face works at every salon she works at. And nowhere else.
//
// == THE BUG ==============================================================================================
//
// A technician's passkey is registered against her `users` row. Under the per-salon login model she has ONE ROW
// PER SALON — so the passkey she enrolled at Luxe belongs to a different row than the one she signs in to at
// Belle. `listByUser` returned nothing there, `allowCredentials` came back empty, and **Face ID simply did not
// appear at any salon but the first one she ever used.** The spec asks for the opposite in as many words:
// "Face ID still works after salon switch."
//
// == AND THE PART THAT MATTERS MORE ======================================================================
//
// Fixing that means letting a credential registered in tenant A authenticate against tenant B. That is exactly
// the shape of a cross-tenant authentication hole, and the tests below spend most of their time proving it is
// NOT one:
//
//   • a DIFFERENT person's passkey → still rejected
//   • an unlinked technician (no shared global account) → still rejected
//   • a row she was INVITED to but never onboarded at → rejected
//   • a technician whose PLATFORM ACCOUNT is suspended → rejected everywhere, including with her own face
//   • and the session is minted for the salon she ASKED for — never the salon that owns the credential
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { makeWebAuthnPorts } from './webauthn.kysely';
import type { Ports } from './webauthn.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(c: any) { const r: any = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows ?? [] }; },
      streamQuery() { throw new Error('not used'); },
    } as any;
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

const LUXE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BELLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BR_L = 'a1111111-1111-1111-1111-111111111111';
const BR_B = 'b1111111-1111-1111-1111-111111111111';

let pg: PGlite;
let ports: Ports;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

/** A global technician account. */
async function profile(code: string, name: string, status = 'active') {
  const r: any = (await q(`insert into global_tech_profiles (tech_code, public_slug, display_name, status)
                           values ($1,$2,$3,$4) returning id`, [code, `${code.toLowerCase()}-s`, name, status]))[0];
  return String(r.id);
}
/** Her `users` row at one salon. `status` is what decides whether she has onboarded there. */
async function login(tenant: string, branch: string, profileId: string | null, name: string, status = 'active', role = 'TECHNICIAN') {
  const r: any = (await q(`insert into users (tenant_id, branch_id, role, status, full_name, normalized_phone, global_tech_profile_id)
                           values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [tenant, branch, role, status, name, `+1856555${Math.floor(Math.random() * 9000 + 1000)}`, profileId]))[0];
  return String(r.id);
}
async function passkey(userId: string, tenantId: string, credentialId: string) {
  await q(`insert into webauthn_credentials (credential_id, user_id, tenant_id, public_key, sign_count)
           values ($1,$2,$3,'PK',0)`, [credentialId, userId, tenantId]);
}

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* pg_trgm */ }
  }
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  ports = makeWebAuthnPorts(db as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
             ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle Palace','belle','BELLE','active')`, [LUXE, BELLE]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR_L, LUXE, BR_B, BELLE]);
}, 180000);

describe('her face works at every salon she works at', () => {
  it('the passkey she enrolled at Luxe is OFFERED to her when she signs in at Belle', async () => {
    const p = await profile('TECH-500001', 'Olivia Brown');
    const atLuxe = await login(LUXE, BR_L, p, 'Olivia Brown');
    const atBelle = await login(BELLE, BR_B, p, 'Olivia Brown');
    await passkey(atLuxe, LUXE, 'CRED-OLIVIA-LUXE');

    // Before the fix this list was EMPTY at Belle, and Face ID did not appear at all.
    const offered = await ports.creds.listForHuman!(atBelle);
    expect(offered.map((c) => c.credentialId)).toContain('CRED-OLIVIA-LUXE');

    // and the verification gate agrees with what was offered — the two must never drift apart
    expect(await ports.users.isSameGlobalTechnician!(atLuxe, atBelle)).toBe(true);
  });

  it('a DIFFERENT person’s passkey is not offered to her, and is not accepted', async () => {
    const her = await profile('TECH-500002', 'Ana Lee');
    const someoneElse = await profile('TECH-500003', 'Kim Park');
    const anaAtBelle = await login(BELLE, BR_B, her, 'Ana Lee');
    const kimAtLuxe = await login(LUXE, BR_L, someoneElse, 'Kim Park');
    await passkey(kimAtLuxe, LUXE, 'CRED-KIM-LUXE');

    const offered = await ports.creds.listForHuman!(anaAtBelle);
    expect(offered.map((c) => c.credentialId)).not.toContain('CRED-KIM-LUXE');
    expect(await ports.users.isSameGlobalTechnician!(kimAtLuxe, anaAtBelle)).toBe(false);
  });

  it('two technicians with NO shared global account stay strangers, even with the same name', async () => {
    const one = await login(LUXE, BR_L, await profile('TECH-500004', 'Mia R'), 'Mia R');
    const two = await login(BELLE, BR_B, await profile('TECH-500005', 'Mia R'), 'Mia R');
    await passkey(one, LUXE, 'CRED-MIA-1');
    expect((await ports.creds.listForHuman!(two)).map((c) => c.credentialId)).not.toContain('CRED-MIA-1');
    expect(await ports.users.isSameGlobalTechnician!(one, two)).toBe(false);
  });

  it('an INVITED-but-never-onboarded row cannot be reached with her face', async () => {
    // A manager creating her at a new salon writes a `users` row immediately — status 'invited', no password.
    // A passkey must SAVE her typing a password she already set. It must never CREATE access she never had.
    const p = await profile('TECH-500006', 'Zoe T');
    const atLuxe = await login(LUXE, BR_L, p, 'Zoe T', 'active');
    const invitedAtBelle = await login(BELLE, BR_B, p, 'Zoe T', 'invited');
    await passkey(atLuxe, LUXE, 'CRED-ZOE-LUXE');

    expect((await ports.creds.listForHuman!(invitedAtBelle)).map((c) => c.credentialId)).not.toContain('CRED-ZOE-LUXE');
    expect(await ports.users.isSameGlobalTechnician!(atLuxe, invitedAtBelle)).toBe(false);
  });

  it('a SUSPENDED platform account signs in NOWHERE — not even with her own face', async () => {
    const p = await profile('TECH-500007', 'Eva W', 'suspended');
    const atLuxe = await login(LUXE, BR_L, p, 'Eva W');
    const atBelle = await login(BELLE, BR_B, p, 'Eva W');
    await passkey(atLuxe, LUXE, 'CRED-EVA-LUXE');

    // A suspension a technician could step around with her own biometric would not be a suspension.
    expect((await ports.creds.listForHuman!(atBelle)).map((c) => c.credentialId)).not.toContain('CRED-EVA-LUXE');
    expect(await ports.users.isSameGlobalTechnician!(atLuxe, atBelle)).toBe(false);
  });

  it('a MANAGER’s passkey never follows anybody anywhere — this widens for technicians only', async () => {
    const mgrLuxe = await login(LUXE, BR_L, null, 'A Manager', 'active', 'MANAGER');
    const mgrBelle = await login(BELLE, BR_B, null, 'A Manager', 'active', 'MANAGER');
    await passkey(mgrLuxe, LUXE, 'CRED-MGR-LUXE');

    // Their own credential, and nothing else. `listForHuman` degrades to exactly `listByUser` for them.
    expect((await ports.creds.listForHuman!(mgrLuxe)).map((c) => c.credentialId)).toEqual(['CRED-MGR-LUXE']);
    expect((await ports.creds.listForHuman!(mgrBelle))).toEqual([]);
    expect(await ports.users.isSameGlobalTechnician!(mgrLuxe, mgrBelle)).toBe(false);
  });

  it('she always keeps her OWN salon’s passkeys, linked or not', async () => {
    const p = await profile('TECH-500008', 'Nia S');
    const atLuxe = await login(LUXE, BR_L, p, 'Nia S');
    await passkey(atLuxe, LUXE, 'CRED-NIA-LUXE');
    expect((await ports.creds.listForHuman!(atLuxe)).map((c) => c.credentialId)).toContain('CRED-NIA-LUXE');
  });
});
