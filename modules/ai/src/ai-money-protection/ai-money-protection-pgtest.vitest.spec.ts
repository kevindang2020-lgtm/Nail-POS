// ai-money-protection-pgtest.vitest.spec.ts — exercises the REAL Kysely repositories against PGlite (Postgres 15):
// deterministic detection + dedup upsert, getState aggregates, listAlerts, investigation create/attach/notes,
// reconciliation reads, platform aggregate, and tenant isolation. Only the money-protection migrations (323/324)
// plus the minimal dependency tables are stood up (the full chain needs pg_trgm which PGlite lacks).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyMoneyProtectionRepository } from './ai-money-protection.kysely.repository';
import { KyselyInvestigationRepository } from './ai-money-protection-investigations.kysely.repository';
import { MoneyProtectionService } from './ai-money-protection.service';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { InMemoryEntitlement } from './ai-money-protection-entitlement';
import type { MoneyProtectionContext } from './ai-money-protection.dto';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[] }; }, async *streamQuery() {} };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

let pg: PGlite;
let db: Kysely<any>;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const ctx = (tenantId: string, perms: string[] = []): MoneyProtectionContext => ({ tenantId, branchId: 'b0000000-0000-0000-0000-0000000000b1', userId: '99999999-9999-9999-9999-999999999999', role: 'OWNER', permissions: perms });
const ALL = ['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.manage_rules', 'ai_money_protection.investigate', 'ai_money_protection.resolve'];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  // dependency tables (minimal columns the repo reads)
  await pg.exec(`
    create table payments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      ticket_id uuid, method text, amount_cents bigint, status text, idempotency_key text, processor_transaction_id text,
      created_by_user_id uuid, created_at timestamptz default now());
    create table tickets (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      subtotal_cents bigint default 0, discount_cents bigint default 0, total_cents bigint default 0, status text,
      updated_at timestamptz default now());
    create table payment_attempts (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      ticket_id uuid, status text, method text, created_at timestamptz default now());
    create table membership_payments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid,
      customer_id uuid, amount_cents bigint, status text, processor_ref text, idempotency_key text, created_at timestamptz default now());
    create table gift_cards (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, balance_cents bigint, status text);
    create table gift_card_transactions (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, gift_card_id uuid, type text, amount_cents bigint, balance_after_cents bigint, created_at timestamptz default now());
    create table cash_drawer_sessions (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, business_date text, variance_cents bigint, counted_cents bigint, expected_cash_cents bigint, status text, created_at timestamptz default now());`);
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/323_money_protection_alerts.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/324_money_protection_investigations.sql`, 'utf8'));

  // Seed tenant A: an exact duplicate charge (shared processor txn) + a paid ticket with no capture.
  const ins = async (sql: string, params: any[]) => pg.query(sql, params);
  await ins(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, processor_transaction_id, created_by_user_id) values ($1,'b0000000-0000-0000-0000-0000000000b1',$2,'card',5000,'approved','TX9',$3),($1,'b0000000-0000-0000-0000-0000000000b1',$2,'card',5000,'approved','TX9',$3)`, [A, '33333333-3333-3333-3333-333333333333', A]);
  await ins(`insert into tickets (id, tenant_id, branch_id, subtotal_cents, total_cents, status) values ($2,$1,'b0000000-0000-0000-0000-0000000000b1',9000,9000,'paid')`, [A, '44444444-4444-4444-4444-444444444444']);
  // Tenant B: its own dup — must never surface for A
  await ins(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, processor_transaction_id, created_by_user_id) values ($1,'b0000000-0000-0000-0000-0000000000b1',$2,'card',7000,'approved','TXB',$1),($1,'b0000000-0000-0000-0000-0000000000b1',$2,'card',7000,'approved','TXB',$1)`, [B, '55555555-5555-5555-5555-555555555555']);
  // Reconciliation data for A: duplicate membership charge + negative gift card + cash variance
  await ins(`insert into membership_payments (tenant_id, branch_id, customer_id, amount_cents, status, idempotency_key) values ($1,'b0000000-0000-0000-0000-0000000000b1',$1,4900,'succeeded','MK1'),($1,'b0000000-0000-0000-0000-0000000000b1',$1,4900,'succeeded','MK1')`, [A]);
  await ins(`insert into gift_cards (tenant_id, branch_id, balance_cents, status) values ($1,'b0000000-0000-0000-0000-0000000000b1',-500,'active')`, [A]);
  await ins(`insert into cash_drawer_sessions (tenant_id, branch_id, business_date, variance_cents, status) values ($1,'b0000000-0000-0000-0000-0000000000b1','2026-07-07',-1500,'reconciled')`, [A]);

  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('KyselyMoneyProtectionRepository (real SQL, PGlite)', () => {
  it('detects, dedups, aggregates, and isolates tenants end-to-end', async () => {
    const repo = new KyselyMoneyProtectionRepository(db);
    const svc = new MoneyProtectionService(repo, new InMemoryEntitlement(() => true));

    // deterministic detection over tenant A's real payments/tickets
    const first = await svc.evaluateDeterministic(ctx(A, ALL), 0);
    expect(first.created).toBeGreaterThanOrEqual(2); // dup_charge_exact + paid_no_capture
    const second = await svc.evaluateDeterministic(ctx(A, ALL), 0); // same day-window → dedup
    expect(second.created).toBe(0);
    expect(second.updated).toBeGreaterThanOrEqual(2);

    // getState aggregates (real FILTER sql)
    const state = await svc.getState(ctx(A, ALL));
    expect(state.criticalAlerts).toBeGreaterThanOrEqual(1); // the exact duplicate
    expect(state.valueUnderReviewCents).toBeGreaterThan(0);
    expect(state.byType.find((t) => t.type === 'duplicate_charge_exact')).toBeTruthy();

    // listAlerts tenant-scoped; tenant B never appears
    const listA = await svc.listAlerts(ctx(A, ALL), {});
    expect(listA.items.length).toBeGreaterThanOrEqual(2);
    expect(listA.items.every((a) => a.tenantId === A)).toBe(true);
    const listB = await svc.listAlerts(ctx(B, ALL), {});
    expect(listB.items.every((a) => a.tenantId === B)).toBe(true);
    expect(listB.items.some((a) => a.alertType === 'duplicate_charge_exact' && a.tenantId === A)).toBe(false);
  });

  it('reconciliation reads produce alerts (membership dup, gift-card, cash variance)', async () => {
    const repo = new KyselyMoneyProtectionRepository(db);
    const svc = new MoneyProtectionService(repo, new InMemoryEntitlement(() => true));
    const r = await svc.evaluateReconciliation(ctx(A, ALL), 0);
    expect(r.created + r.updated).toBeGreaterThanOrEqual(3);
    const types = (await svc.listAlerts(ctx(A, ALL), { limit: 100 })).items.map((a) => a.alertType);
    expect(types).toContain('duplicate_membership_charge');
    expect(types).toContain('giftcard_negative_balance');
    expect(types).toContain('cash_drawer_variance');
  });

  it('platform aggregate returns cross-tenant counts with no tenant ids', async () => {
    const repo = new KyselyMoneyProtectionRepository(db);
    // seed B alerts too
    await new MoneyProtectionService(repo, new InMemoryEntitlement(() => true)).evaluateDeterministic(ctx(B, ALL), 0);
    const agg = await repo.platformAggregate();
    expect(agg.tenantsWithOpenAlerts).toBeGreaterThanOrEqual(2);
    expect(agg.totalOpenAlerts).toBeGreaterThan(0);
    expect(JSON.stringify(agg)).not.toContain(A);
  });
});

describe('KyselyInvestigationRepository (real SQL, PGlite)', () => {
  it('creates an investigation from alerts, attaches them, and appends notes', async () => {
    const alertRepo = new KyselyMoneyProtectionRepository(db);
    const invRepo = new KyselyInvestigationRepository(db);
    const svc = new InvestigationService(invRepo, alertRepo);

    const alerts = (await alertRepo.listAlerts(ctx(A), { alertType: 'duplicate_charge_exact', limit: 1 })).items;
    expect(alerts.length).toBe(1);

    const inv = await svc.create(ctx(A, ALL), { title: 'Dup charge review', alertIds: [alerts[0].id] });
    expect(inv.valueUnderReviewCents).toBeGreaterThan(0);

    // the alert was attached (investigation_id set + status INVESTIGATING)
    const [attached] = await alertRepo.getAlertsByIds(ctx(A), [alerts[0].id]);
    expect(attached.investigationId).toBe(inv.id);
    expect(attached.status).toBe('INVESTIGATING');

    // append-only notes
    await svc.addNote(ctx(A, ALL), inv.id, 'first');
    await svc.addNote(ctx(A, ALL), inv.id, 'second');
    const { notes } = await svc.get(ctx(A, ALL), inv.id);
    expect(notes.map((n) => n.body)).toEqual(['first', 'second']);

    // tenant B cannot see A's investigation
    expect(await svc.list(ctx(B, ALL), {})).toHaveLength(0);
  });
});
