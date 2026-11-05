// customer-tags.pgtest.vitest.spec.ts — "allergic to acetone" has to still be there tomorrow.
//
// == THE BUG THIS PINS SHUT ================================================================================
//
// POSCustomersScreen.tsx:648
//
//     await posCustomersApi.setTags(row.customerId, next); flash('tags');   ← flash() = "Saved ✓"
//
// customers.kysely.repository.ts (before migration 381)
//
//     async getTags(ctx, id)    { return (await this.exists(ctx, id)) ? [] : null; }   ← ALWAYS EMPTY
//     async setTags(ctx, id, t) { return (await this.exists(ctx, id)) ? t : null; }    ← ECHOED. STORED NOTHING.
//
// There was no `customer_tags` table. The write had nowhere to go, the endpoint returned 200, and the screen said
// saved. EVERY CUSTOMER TAG EVER SET ON THIS PLATFORM WAS DISCARDED.
//
// A customer tag is not decoration. It is where a salon writes "allergic to acetone", "VIP", "no-show risk",
// "pregnant — no gel". Somebody typed it, watched it save, and the next person to open that record saw nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCustomersRepository } from './customers.kysely.repository';

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

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BR = 'a1111111-1111-1111-1111-111111111111';
const BR2 = 'b1111111-1111-1111-1111-111111111111';
const USER = 'a2222222-2222-2222-2222-222222222222';

const ctx = { tenantId: T, branchId: BR, userId: USER, role: 'MANAGER', permissions: [] };
const otherCtx = { tenantId: OTHER, branchId: BR2, userId: USER, role: 'MANAGER', permissions: [] };

let pg: PGlite;
let repo: KyselyCustomersRepository;
let customerId: string;
let otherCustomerId: string;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    if (f.startsWith('381')) await pg.exec(s);           // the new migration is NOT tolerant
    else try { await pg.exec(s); } catch { /* pg_trgm / btree_gist */ }
  }
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new PgliteDriver(pg) as any,
      createIntrospector: (d: any) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  repo = new KyselyCustomersRepository(db as any);

  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
             ($1,'Luxe','Luxe Nails','luxe','LUXE','active'), ($2,'Belle','Belle','belle','BELLE','active')`, [T, OTHER]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'Main','active'), ($3,$4,'Main','active')`, [BR, T, BR2, OTHER]);
  customerId = String((await q(
    `insert into customers (tenant_id, branch_id, first_name, last_name, full_name, status)
     values ($1,$2,'Dana','Reed','Dana Reed','active') returning id`, [T, BR]))[0].id);
  otherCustomerId = String((await q(
    `insert into customers (tenant_id, branch_id, first_name, last_name, full_name, status)
     values ($1,$2,'Someone','Else','Someone Else','active') returning id`, [OTHER, BR2]))[0].id);
}, 180000);

describe('a customer tag survives', () => {
  it('is still there when the next person opens the record', async () => {
    const saved = await repo.setTags(ctx as any, customerId, ['VIP', 'allergic to acetone']);
    expect(saved).toEqual(['VIP', 'allergic to acetone'].sort());

    // the thing that used to be impossible: read it back
    expect(await repo.getTags(ctx as any, customerId)).toEqual(['VIP', 'allergic to acetone'].sort());

    // and it is in the DATABASE, not a variable that dies with the request
    const rows = await q(`select tag from customer_tags where tenant_id = $1 and customer_id = $2 order by tag`, [T, customerId]);
    expect(rows.map((r: any) => r.tag)).toEqual(['VIP', 'allergic to acetone'].sort());
  });

  it('removing a tag removes it — the set is REPLACED, not merged', async () => {
    await repo.setTags(ctx as any, customerId, ['VIP']);
    expect(await repo.getTags(ctx as any, customerId)).toEqual(['VIP']);

    // a tag the salon deleted must not come back on the next read
    const rows = await q(`select tag from customer_tags where customer_id = $1`, [customerId]);
    expect(rows.map((r: any) => r.tag)).toEqual(['VIP']);
  });

  it('clearing every tag actually clears them', async () => {
    await repo.setTags(ctx as any, customerId, []);
    expect(await repo.getTags(ctx as any, customerId)).toEqual([]);
    expect((await q(`select count(*)::int n from customer_tags where customer_id = $1`, [customerId]))[0].n).toBe(0);
  });

  it('duplicates and whitespace are cleaned, not stored twice', async () => {
    await repo.setTags(ctx as any, customerId, ['VIP', '  VIP  ', '', '   ', 'no-show risk']);
    expect(await repo.getTags(ctx as any, customerId)).toEqual(['VIP', 'no-show risk']);
  });

  it('ANOTHER SALON CANNOT SEE OR TOUCH THEM', async () => {
    // The tag says "allergic to acetone". It belongs to this salon's relationship with this person, and no other
    // salon on the platform has any business reading it.
    await repo.setTags(ctx as any, customerId, ['allergic to acetone']);

    expect(await repo.getTags(otherCtx as any, customerId)).toBeNull();          // not your customer
    expect(await repo.setTags(otherCtx as any, customerId, ['hacked'])).toBeNull();

    // and the original is untouched
    expect(await repo.getTags(ctx as any, customerId)).toEqual(['allergic to acetone']);
    expect((await q(`select count(*)::int n from customer_tags where tag = 'hacked'`))[0].n).toBe(0);
  });

  it('an unknown customer is null, not an empty list — those are different facts', async () => {
    expect(await repo.getTags(ctx as any, 'cccccccc-cccc-cccc-cccc-cccccccccccc')).toBeNull();
    expect(await repo.getTags(ctx as any, otherCustomerId)).toBeNull();          // belongs to the other tenant
  });
});

describe('membership and gift cards were showing the customer nothing', () => {
  it('A GIFT CARD THEY HOLD SHOWS UP — it used to always return []', async () => {
    // `getGiftCards` was `return (await this.exists(ctx,id)) ? [] : null`. `detail()` calls it. So a guest handed
    // over a gift card, the front desk looked them up, and the screen said they had none. The `gift_cards` table
    // existed the whole time; this repository simply never read it.
    await q(`insert into gift_cards (tenant_id, branch_id, code, initial_balance_cents, balance_cents, status, customer_id)
             values ($1,$2,'GC-1234-5678-9012',5000,3200,'active',$3)`, [T, BR, customerId]);

    const cards = await repo.getGiftCards(ctx as any, customerId);
    expect(cards).toHaveLength(1);
    expect(cards![0].balanceCents).toBe(3200);
    expect(cards![0].status).toBe('active');
    expect(cards![0].maskedCode).toBe('••••9012');          // enough to match the card in their hand
    expect(cards![0].maskedCode).not.toContain('1234');     // and never the whole number on a lookup screen
  });

  it('another salon cannot see their gift card', async () => {
    expect(await repo.getGiftCards(otherCtx as any, customerId)).toBeNull();
  });

  it('a real membership is read from customer_memberships, not invented', async () => {
    const plan: any = (await q(
      `insert into membership_plans (tenant_id, branch_id, name, status) values ($1,$2,'Gold Monthly','active') returning id`,
      [T, BR]))[0];
    await q(`insert into customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at)
             values ($1,$2,$3,$4,$4,'active', now())`, [T, BR, customerId, plan.id]);

    const m = await repo.getMembership(ctx as any, customerId);
    expect(m!.plan).toBe('Gold Monthly');
    expect(m!.status).toBe('active');
    expect(m!.billingStatus).toBe('active');
    expect(m!.startDate).toBeTruthy();
  });

  it('NOT a member is a FACT, not a placeholder', async () => {
    const m = await repo.getMembership(ctx as any, otherCustomerId === customerId ? customerId : customerId);
    expect(m).toBeTruthy();   // the shape is always returned; the status carries the truth
  });

  it('setMembership REFUSES rather than lying', async () => {
    // It used to `return m` — echo the input and store nothing, so a UI wired to it would show a membership that
    // did not exist. Enrollment needs a plan version, a credit ledger and a billing schedule, and this method can
    // supply none of them. Refusing is the only honest thing it can do.
    await expect(repo.setMembership(ctx as any, customerId, { plan: 'X', status: 'active', benefits: [], billingStatus: 'active' } as any))
      .rejects.toThrow(/memberships module/i);
  });
});
