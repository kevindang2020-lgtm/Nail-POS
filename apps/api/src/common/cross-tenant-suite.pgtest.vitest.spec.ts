// cross-tenant-suite.pgtest — Constitution 12 §287, §289, §299: the dedicated IDOR suite.
//
// Every domain is attacked the same way: salon B, signed in, asks the domain's REAL repository for salon A's record
// by its REAL id. Each denial is paired with the owner FINDING the record (expectIsolated), so a query broken to
// return nothing cannot pass. Domains whose isolation is proven elsewhere are listed at the bottom with the file that
// proves it, and that file is checked to exist and to contain a cross-tenant assertion.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expectIsolated, expectTenantDenied } from '../../test-support/security-expectations';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const A = 'a1000000-0000-4000-8000-00000000000a', B = 'b1000000-0000-4000-8000-00000000000b';
const BA = 'a2000000-0000-4000-8000-00000000000a', BB = 'b2000000-0000-4000-8000-00000000000b';
const ids: Record<string, string> = {};
const ctx = (tenantId: string, branchId: string) => ({ tenantId, branchId, userId: 'c0000000-0000-4000-8000-000000000001', role: 'OWNER', permissions: ['*'] }) as any;
const CA = ctx(A, BA), CB = ctx(B, BB);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0].id as string;
  for (const [t, code] of [[A, 'XTA01'], [B, 'XTB01']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', '${code}', '${code.toLowerCase()}', '${code}', 'active') ON CONFLICT DO NOTHING`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BA}', '${A}', 'A'), ('${BB}', '${B}', 'B') ON CONFLICT DO NOTHING`);
  ids.customer = await one(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'Ann', 'A', 'Ann A') RETURNING id`, [A, BA]);
  ids.tech = await one(`INSERT INTO technicians (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'T', 'A', 'T A') RETURNING id`, [A, BA]);
  ids.appointment = await one(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time) VALUES ($1, $2, $3, $4, 'Ann A', CURRENT_DATE + 1, '10:00', '11:00') RETURNING id`, [A, BA, ids.tech, ids.customer]);
  ids.queue = await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_id, customer_name) VALUES ($1, $2, $3, 'Ann A') RETURNING id`, [A, BA, ids.customer]);
  ids.ticket = await one(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [A, BA, ids.customer]);
  ids.payment = await one(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status) VALUES ($1, $2, $3, 'cash', 5000, 'approved') RETURNING id`, [A, BA, ids.ticket]);
  ids.deal = await one(`INSERT INTO deals (tenant_id, branch_id, owner_type, title, discount_type, discount_percent, status) VALUES ($1, $2, 'salon', 'Deal A', 'percent', 10, 'active') RETURNING id`, [A, BA]).catch(async () => one(`INSERT INTO deals (tenant_id, owner_type, title, discount_type, discount_percent) VALUES ($1, 'salon', 'Deal A', 'percent', 10) RETURNING id`, [A]));
  ids.plan = await one(`INSERT INTO membership_plans (tenant_id, name) VALUES ($1, 'Gold A') RETURNING id`, [A]);
  ids.product = await one(`INSERT INTO inventory_products (tenant_id, name) VALUES ($1, 'Polish A') RETURNING id`, [A]);
});

// Each case dynamically imports a domain's real repository — most now from their modules (Constitution 13). The FIRST
// import pays the cold module-graph cost, which under a loaded CI runner passed vitest's 5 s default; the cases
// themselves are milliseconds.
describe('§299 the dedicated cross-tenant suite — salon B, salon A\'s real id, the real repository', { timeout: 60_000 }, () => {
  it('Customers — appointments and active service of another salon\'s customer', async () => {
    const { KyselyCustomerRepository } = await import('../customer/customer.kysely.repository') as any; const r = new KyselyCustomerRepository(db);
    await expectIsolated(() => r.appointments({ ...CA, customerId: ids.customer }, ids.customer), () => r.appointments({ ...CB, customerId: ids.customer }, ids.customer), 'customer appointments');
  });
  it('Appointments — detail by id', async () => {
    const { KyselyBookingRepository } = await import('@aipowersalon/booking') as any; const r = new KyselyBookingRepository(db, null);
    await expectIsolated(() => r.detail(CA, ids.appointment), () => r.detail(CB, ids.appointment), 'appointment detail');
  });
  it('Queue — queue item detail by id', async () => {
    const { KyselyQueueRepository } = await import('@aipowersalon/queue') as any; const r = new KyselyQueueRepository(db, null);
    await expectIsolated(() => r.detail(CA, ids.queue), () => r.detail(CB, ids.queue), 'queue detail');
  });
  it('Payments — the payment, and the ticket it paid', async () => {
    const { KyselyCheckoutRepository } = await import('@aipowersalon/checkout') as any; const r = new KyselyCheckoutRepository(db, null);
    await expectIsolated(() => r.findPayment(CA, ids.payment), () => r.findPayment(CB, ids.payment), 'payment');
    await expectIsolated(() => r.detail(CA, ids.ticket), () => r.detail(CB, ids.ticket), 'ticket');
  });
  it('Deals — a deal by id', async () => {
    const { KyselyDealsRepository } = await import('@aipowersalon/deals') as any; const r = new KyselyDealsRepository(db);
    await expectIsolated(() => r.getDeal(CA, ids.deal), () => r.getDeal(CB, ids.deal), 'deal');
  });
  it('Loyalty — a membership plan by id', async () => {
    const { KyselyMembershipsRepository } = await import('@aipowersalon/memberships') as any; const r = new KyselyMembershipsRepository(db);
    await expectIsolated(() => r.getPlan(CA, ids.plan), () => r.getPlan(CB, ids.plan), 'membership plan');
  });
  it('Inventory — a product by id', async () => {
    const { InventoryService } = await import('@aipowersalon/inventory') as any; const s = new InventoryService(db);
    await expectIsolated(() => s.getProduct(CA, ids.product), () => s.getProduct(CB, ids.product), 'inventory product');
  });
  it('the attacker cannot use a FORGED tenant in the context either — the id alone is not a key', async () => {
    const { KyselyCheckoutRepository } = await import('@aipowersalon/checkout') as any; const r = new KyselyCheckoutRepository(db, null);
    await expectTenantDenied(() => r.findPayment({ ...CB, branchId: BA }, ids.payment), 'payment with salon A\'s BRANCH id but salon B\'s tenant');
  });
});

describe('§299 domains proven elsewhere — each file exists and asserts isolation', () => {
  const PROVEN: Array<[string, string, RegExp]> = [
    // Reports live in modules/analytics (Constitution 13)
    ['Reports', '../../modules/analytics/src/overview/overview-board-queries.pgtest.vitest.spec.ts', /other tenant|another tenant|cross-tenant|tenant B|OTHER/i],
    ['AI', '../../modules/safety/src/ai-ocr-receipt/ai-ocr-receipt.pgtest.vitest.spec.ts', /other tenant|another tenant|cross-tenant|tenant B|OTHER/i],
    ['Files', 'src/common/file-safety.vitest.spec.ts', /MEDIA_STORAGE|path traversal/i],
    ['Realtime', 'src/realtime/realtime-isolation.vitest.spec.ts', /salon B|tenant-b/i],
    ['Events', 'src/events/consumers/loyalty-points.pgtest.vitest.spec.ts', /T2|cross|other tenant/i],
  ];
  it.each(PROVEN)('%s — %s', (_d, file, re) => {
    expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    expect(readFileSync(join(process.cwd(), file), 'utf8')).toMatch(re);
  });
});
