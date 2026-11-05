// gift-card-branch.postgres-race.vitest.spec.ts — Functional Decision 31 on real Postgres (migration 489): a card sold at
// Branch A and redeemed at Branch B — every ledger row records the branch where it happened, so the tenant can report
// branch-level sold / redeemed and inter-branch clearing. Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { businessDate } from '@aipowersalon/date-time';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { GiftCardsService, KyselyGiftCardsRepository } from '@aipowersalon/gift-cards';

const url = process.env.PG_RACE_URL;
const T = 'a3100000-0000-4000-8000-0000000000aa';
const A = 'b3100000-0000-4000-8000-00000000000a';
const B = 'b3100000-0000-4000-8000-00000000000b';
const user = 'e3100000-0000-4000-8000-0000000000ee';
const at = (branchId: string) => ({ tenantId: T, branchId, userId: user, role: 'FRONT_DESK', permissions: [] }) as any;
let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository;

describe.skipIf(!url)('gift-card ledger rows carry their branch (Decision 31)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'D31 Salon', 'D31 Salon', 'd31-salon', 'D31S', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${A}, ${T}, 'Cherry Hill', 'active'), (${B}, ${T}, 'Moorestown', 'active') on conflict (id) do nothing`.execute(db);
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from tickets where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from customers where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('$100 sold at Cherry Hill, $60 redeemed at Moorestown: the issue row is Cherry Hill, the redeem row Moorestown', async () => {
    await repo.issueGiftCard(at(A), { code: 'D31-100', amountCents: 10000, idempotencyKey: 'd31-issue' });
    expect(await repo.decrementGift(at(B), 'D31-100', 6000)).toBe(true);
    const rows = (await sql<{ type: string; branch_id: string | null; amount_cents: string }>`select type, branch_id, amount_cents from gift_card_transactions where tenant_id = ${T} order by created_at, type`.execute(db)).rows;
    expect(rows.map((r) => [r.type, r.branch_id, Number(r.amount_cents)])).toEqual([['issue', A, 10000], ['redeem', B, 6000]]);
    const card = (await sql<{ balance_cents: string }>`select balance_cents from gift_cards where tenant_id = ${T} and code = 'D31-100'`.execute(db)).rows[0];
    expect(Number(card.balance_cents)).toBe(4000);               // the tenant still owes $40
  });

  it('the 489 backfill places old rows only where the branch is known — a ticket\'s branch — and leaves the rest unattributed', async () => {
    const card = (await sql<{ id: string }>`select id from gift_cards where tenant_id = ${T} and code = 'D31-100'`.execute(db)).rows[0].id;
    const cust = (await sql<{ id: string }>`insert into customers (tenant_id, branch_id, first_name, last_name, full_name) values (${T}, ${B}, 'Gina', 'Gift', 'Gina Gift') returning id`.execute(db)).rows[0].id;
    const ticket = (await sql<{ id: string }>`insert into tickets (tenant_id, branch_id, customer_id, status) values (${T}, ${B}, ${cust}, 'paid') returning id`.execute(db)).rows[0].id;
    await sql`insert into gift_card_transactions (tenant_id, gift_card_id, type, amount_cents, balance_after_cents, ticket_id) values (${T}, ${card}, 'redeem', 500, 3500, ${ticket}), (${T}, ${card}, 'adjust', -100, 3400, null)`.execute(db);
    const migration = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../../../apps/api/db/migrations/489_gift_card_transaction_branch.sql', import.meta.url), 'utf8'));
    await sql.raw(migration).execute(db);                          // the migration is re-runnable
    const rows = (await sql<{ amount_cents: string; branch_id: string | null }>`select amount_cents, branch_id from gift_card_transactions where tenant_id = ${T} and amount_cents in (500, -100) order by amount_cents`.execute(db)).rows;
    expect(rows.map((r) => [Number(r.amount_cents), r.branch_id])).toEqual([[-100, null], [500, B]]);
  });

  it('the liability report: Cherry Hill sold the card, Moorestown redeemed $65 of it → Cherry Hill owes Moorestown $65; the tenant owes the card balance', async () => {
    // The report's days are the branch's days (since Oct 2); the UTC date made this test fail between 8 pm and midnight EDT.
    const today = businessDate('America/New_York');
    const svc = new GiftCardsService(new KyselyGiftCardsRepository(db as any));
    const r = await svc.getLiability({ tenantId: T, branchId: A, userId: user, role: 'MANAGER', permissions: ['reports.view'] }, { from: today, to: today });
    expect(r.outstandingLiabilityCents).toBe(4000);   // the card's balance (the backfill rows above were inserted without moving it)
    // Moorestown redeemed $65 of a card Cherry Hill sold → Cherry Hill owes Moorestown $65; the $1 adjustment has no branch.
    expect(r.branches.map((b) => [b.branchName, b.soldCents, b.redeemedCents, b.adjustedCents, b.owesCents, b.owedCents])).toEqual([
      ['Cherry Hill', 10000, 0, 0, 6500, 0],
      ['Moorestown', 0, 6500, 0, 0, 6500],
      ['Not attributed', 0, 0, -100, 0, 0],
    ]);
    expect(r.transfers).toEqual([{ fromBranchId: A, fromBranchName: 'Cherry Hill', toBranchId: B, toBranchName: 'Moorestown', amountCents: 6500 }]);
  });
});
