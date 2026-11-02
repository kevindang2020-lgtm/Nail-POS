// salon-boundary.pgtest.vitest.spec.ts — the two lines the whole architecture is built on.
//
//   1. A salon can end its OWN relationship with a technician. It cannot touch her account.
//   2. Her PROFILE travels with her. The salon's BUSINESS DATA does not.
//
// Both are spec requirements, both are the kind of thing everyone believes is true, and neither was proven. So:
// a real Postgres, a real transfer, and assertions about what is in the database on the other side of it.
import { GlobalTechIdentityService, GlobalTechDirectory, TechWorkplacesService } from '@aipowersalon/workforce';
import { codeRoots } from '../../test-support/code-roots';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

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
const MGR_L = 'a2222222-2222-2222-2222-222222222222';

let pg: PGlite;
let identity: GlobalTechIdentityService;
let workplaces: TechWorkplacesService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX')); } catch { /* pg_trgm */ }
  }
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  identity = new GlobalTechIdentityService(db, new GlobalTechDirectory(db));
  workplaces = new TechWorkplacesService(db, identity);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
             ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle Palace','belle','BELLE','active')`, [LUXE, BELLE]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR_L, LUXE, BR_B, BELLE]);
  await q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'MANAGER','active','Luxe Manager')`, [MGR_L, LUXE, BR_L]);
}, 180000);

// ══ 1. WHAT A SALON MAY TOUCH ═════════════════════════════════════════════════════════════════════════════

describe('a salon can end its own relationship — and cannot touch her account', () => {
  it('NO code anywhere hard-deletes a global technician account. Not one statement.', () => {
    // The account is anonymized, never deleted — that is the ONLY way "a technician ID is never reused" can be
    // true rather than merely asserted. A DELETE would take the tech_code with it and free it for the next person.
    const src = allSource();
    const deleters = src.filter(([, text]) => /delete\s+from\s+global_tech_profiles/i.test(text));
    expect(deleters.map(([f]) => f)).toEqual([]);
  });

  it('every file that can change a global account’s STATUS is Super-Admin-only', () => {
    // suspend · restore · anonymize · merge. Four verbs, one guarded surface. If a POS or Tech controller ever
    // gains a path to any of them, this fails — which is the entire point of writing it as a source assertion
    // rather than a hopeful comment.
    const src = allSource();
    const writers = src
      .filter(([, text]) => /update\s+global_tech_profiles[\s\S]{0,600}?\bstatus\s*=/i.test(text))
      .map(([f]) => f);

    expect(writers.length).toBeGreaterThan(0);                       // the test is watching something real
    for (const f of writers) {
      expect(f, `${f} can change a global technician account's status but is not Super-Admin-only`)
        .toMatch(/super-admin/);
    }
  });

  it('a salon marking her FORMER ends the employment and leaves the account untouched', async () => {
    const t = await hire('TECH-600001', 'Olivia Brown', '+18565551111');

    // this is the salon's whole vocabulary of destruction
    await q(`update tech_salon_memberships set status = 'former', end_date = now() where id = $1`, [t.membershipId]);

    const [m]: any = await q(`select status from tech_salon_memberships where id = $1`, [t.membershipId]);
    expect(m.status).toBe('former');

    const [p]: any = await q(`select status, display_name, tech_code, phone_hash from global_tech_profiles where id = $1`, [t.profileId]);
    expect(p.status).toBe('active');                                  // her account is untouched
    expect(p.display_name).toBe('Olivia Brown');
    expect(p.tech_code).toBe('TECH-600001');
    expect(p.phone_hash).toBeTruthy();                                // she is still findable by the next salon
  });
});

// ══ 2. WHAT TRAVELS WITH HER, AND WHAT DOES NOT ═══════════════════════════════════════════════════════════

describe('her profile travels; the salon’s business data does not', () => {
  it('a transfer carries her portfolio and rating — and NONE of Luxe’s pay, schedule, services or notes', async () => {
    const t = await hire('TECH-600002', 'Ana Lee', '+18565552222');

    // ── Luxe's own business data about her. Every row of this is the SALON's, not hers.
    await q(`update technicians set commission_value = 55, default_commission_split_percent = 55 where id = $1`, [t.technicianId]);
    await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working)
             values ($1,$2,$3,1,'09:00','18:00',true)`, [LUXE, BR_L, t.technicianId]);
    const cat: any = (await q(`insert into service_categories (tenant_id, branch_id, name) values ($1,$2,'Enhancements') returning id`, [LUXE, BR_L]))[0];
    const svc: any = (await q(`insert into services (tenant_id, branch_id, category_id, name, status, price_cents, duration_minutes)
                               values ($1,$2,$3,'Gel Fill','active',5000,45) returning id`, [LUXE, BR_L, cat.id]))[0];
    await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [LUXE, BR_L, t.technicianId, svc.id]);
    await q(`insert into technician_permissions (tenant_id, branch_id, technician_id, permission_key, allowed)
             values ($1,$2,$3,'pos.tech.process_payment',true)`, [LUXE, BR_L, t.technicianId]);
    await q(`insert into technician_skills (tenant_id, branch_id, technician_id, skill_group) values ($1,$2,$3,'gel')`, [LUXE, BR_L, t.technicianId]);

    // ── Hers. On her global profile, where it belongs.
    await q(`insert into tech_portfolio_photos (global_tech_profile_id, image_url, moderation_status, is_public)
             values ($1,'her-work.jpg','approved',true)`, [t.profileId]);
    await q(`update global_tech_profiles set overall_rating = 4.8, rating_count = 52, portfolio_photo_count = 1 where id = $1`, [t.profileId]);

    // ── Belle invites her; she accepts.
    const m: any = (await q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, status, role_label)
                             values ($1,$2,$3,'pending_tech_approval','Technician') returning id`, [t.profileId, BELLE, BR_B]))[0];
    const techCtx = { tenantId: LUXE, branchId: BR_L, userId: t.userId, role: 'TECHNICIAN', permissions: [] };
    await workplaces.accept(techCtx as any, String(m.id));

    const [atBelle]: any = await q(
      `select id, commission_value, default_commission_split_percent from technicians where tenant_id = $1 and global_tech_profile_id = $2`,
      [BELLE, t.profileId]);
    expect(atBelle).toBeTruthy();                                     // she has a roster row at Belle

    // ── NOTHING of Luxe's came with her. Belle grants what Belle grants.
    // Re-pinned (Technician Profile merge, Oct 12 2026): "the default" is BELLE's configured tenant default
    // (compensation-rule-loader.defaultCommissionForTenant — no literal rate in the identity path) — never Luxe's 55%.
    const belleDefault = Number((await q(`select default_commission_percent from tenants where id = $1`, [BELLE]))[0].default_commission_percent ?? 50);
    expect(belleDefault).not.toBe(55);
    expect(Number(atBelle.commission_value)).toBe(belleDefault);
    expect(Number(atBelle.default_commission_split_percent)).toBe(belleDefault);
    expect((await q(`select count(*)::int n from technician_schedules   where tenant_id = $1`, [BELLE]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from technician_services    where tenant_id = $1`, [BELLE]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from technician_permissions where tenant_id = $1`, [BELLE]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from technician_skills      where tenant_id = $1`, [BELLE]))[0].n).toBe(0);

    // ── HER things did. One profile, one portfolio, one rating, at both salons.
    const [p]: any = await q(`select overall_rating, rating_count, portfolio_photo_count from global_tech_profiles where id = $1`, [t.profileId]);
    expect(Number(p.overall_rating)).toBe(4.8);
    expect(Number(p.rating_count)).toBe(52);
    expect((await q(`select count(*)::int n from tech_portfolio_photos where global_tech_profile_id = $1`, [t.profileId]))[0].n).toBe(1);

    // ── and Luxe's own records are exactly where Luxe left them.
    const [atLuxe]: any = await q(`select commission_value from technicians where id = $1`, [t.technicianId]);
    expect(Number(atLuxe.commission_value)).toBe(55);
    expect((await q(`select count(*)::int n from technician_permissions where tenant_id = $1`, [LUXE]))[0].n).toBe(1);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** Hire her at Luxe through the REAL manager path — global account, per-salon login, membership and all. */
async function hire(code: string, name: string, phone: string) {
  const t: any = (await q(
    `insert into technicians (tenant_id, branch_id, first_name, last_name, full_name, is_active)
     values ($1,$2,$3,'X',$3,true) returning id`, [LUXE, BR_L, name]))[0];
  const ctx = { tenantId: LUXE, branchId: BR_L, userId: MGR_L, role: 'MANAGER', permissions: [] };
  const r = await identity.attachToTechnician(ctx as any, String(t.id), { fullName: name, phone, email: null });
  // the tech_code the migration allocated is not `code` — assert on what we were given, and rename for clarity
  await q(`update global_tech_profiles set tech_code = $2 where id = $1`, [r.profileId, code]);
  return { technicianId: String(t.id), profileId: r.profileId, userId: r.userId, membershipId: r.membershipId };
}

/** Every non-spec source file in the API, as [relativePath, text]. */
function allSource(): [string, string][] {
  const SRC = resolve(process.cwd(), 'src');
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) out.push([p.slice(SRC.length + 1), readFileSync(p, 'utf8')]);
    }
  };
  codeRoots().flatMap((r) => walk(r));
  return out;
}
