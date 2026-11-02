// tenant-approvals.pgtest — BUILD_PLAN Phase 9 (agent D): the salon's ONE approvals engine wired to the three flows that moved
// onto it, end to end on the real schema (PGlite): the REAL engine + the REAL checkout refund (Kysely repository), deals and
// inventory services — exactly how the API composes them (each domain registers its executor on the engine).
//   refund        front desk (who cannot refund) asks → the manager approves → the refund runs ONCE, as the manager
//                 a refund clerk past the SALON's limit → approval_pending (not a 403); the owner raises the limit → direct
//   purchase order a new PO files a request; the approve route decides THROUGH it; separation when the salon turns it on;
//                 a rejection cancels the PO
//   deal          submitting files a request; the deals approve route decides through it
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';
import { TenantApprovalsService } from '@aipowersalon/workforce';
import { CheckoutService, KyselyCheckoutRepository } from '@aipowersalon/checkout';
import { DealsService, KyselyDealsRepository } from '@aipowersalon/deals';
import { InventoryService } from '@aipowersalon/inventory';

const id = (n: number) => `b7b7b7b7-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), BR = id(2), CUST = id(3), TICKET = id(4), PAY = id(5), PAY2 = id(6), PROD = id(7);
const FD = id(10), MGR = id(11), OWN = id(12), MGR2 = id(13), CLERK = id(14);
const perms = (role: string) => [...((ROLE_PERMISSIONS as any)[role] ?? [])] as string[];
const actor = (userId: string, role: string, extra: string[] = []) => ({ tenantId: T, branchId: BR, userId, role, permissions: [...perms(role), ...extra] });
const fd = actor(FD, 'FRONT_DESK'), mgr = actor(MGR, 'MANAGER'), own = { ...actor(OWN, 'OWNER'), branchId: null as string | null }, mgr2 = actor(MGR2, 'MANAGER');

let db: any; let engine: TenantApprovalsService; let checkout: CheckoutService; let deals: DealsService; let inventory: InventoryService;
const count = async (q: any) => Number((await q.execute(db)).rows[0].n);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Approvals', 'Approvals', 'aprv-wire', 'APRVW', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${BR}, ${T}, 'Main', 'active')`.execute(db);
  for (const [u, role, name] of [[FD, 'FRONT_DESK', 'Fran Desk'], [MGR, 'MANAGER', 'Mona Manager'], [OWN, 'OWNER', 'Olga Owner'], [MGR2, 'MANAGER', 'Max Manager'], [CLERK, 'FRONT_DESK', 'Cleo Clerk']]) {
    await sql`insert into users (id, tenant_id, branch_id, role, full_name, email, status) values (${u}, ${T}, ${BR}, ${role}, ${name}, ${u + '@x.test'}, 'active')`.execute(db);
  }
  // the ticket's customer exists (fk_tickets_customer, Phase 10 migration 538)
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${BR}, 'Cara', 'Cust', 'Cara Cust')`.execute(db);
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status) values (${TICKET}, ${T}, ${BR}, ${CUST}, 'paid')`.execute(db);
  await sql`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${PAY}, ${T}, ${BR}, ${TICKET}, 'cash', 8000, 0, 'approved'), (${PAY2}, ${T}, ${BR}, ${TICKET}, 'cash', 9000, 0, 'approved')`.execute(db);
  await sql`insert into inventory_products (id, tenant_id, name) values (${PROD}, ${T}, 'Gel polish')`.execute(db);
  const outbox = new OutboxWriter();
  engine = new TenantApprovalsService(db, outbox);
  checkout = new CheckoutService(new KyselyCheckoutRepository(db, outbox)).useApprovals(engine as any);
  deals = new DealsService(new KyselyDealsRepository(db, outbox)).useApprovals(engine as any);
  inventory = new InventoryService(db, undefined, outbox).useApprovals(engine as any);
});

describe('refund over the limit — on the engine', () => {
  it('the stock front desk cannot refund at all, so it ASKS: the engine checks the payment and rebuilds the payload', async () => {
    await expect(checkout.refund(fd, PAY, { reason: 'x', amountCents: 100 })).rejects.toThrow(/Missing pos\.checkout\.refund/);
    await expect(engine.request(fd, { kind: 'refund', subjectType: 'payment', subjectId: PAY, amountCents: 999_999, reason: 'Color came out wrong' })).rejects.toMatchObject({ code: 'invalid_subject', status: 400 });
    const { request, created } = await engine.request(fd, { kind: 'refund', subjectType: 'payment', subjectId: PAY, amountCents: 8_000, reason: 'Color came out wrong', payload: { paymentId: PAY2, amountCents: 1 } });
    expect(created).toBe(true);
    expect(request).toMatchObject({ status: 'pending', title: 'Refund $80.00 (cash)', amountCents: 8_000, requestedByName: 'Fran Desk', branchName: 'Main', payload: { paymentId: PAY, amountCents: 8_000, method: 'cash' } });
  });
  it('the manager approves → the refund executes ONCE, as the manager; nothing moved before', async () => {
    const live = (await engine.list(mgr, { status: 'pending', kind: 'refund' })).items[0];
    expect(live.canDecide).toBe(true);
    expect(await count(sql`select count(*)::int as n from payment_refunds where tenant_id = ${T}`)).toBe(0);
    const done = await engine.decide(mgr, live.id, { decision: 'approve', note: 'ok', expectedVersion: live.version });
    expect(done).toMatchObject({ status: 'executed', decidedByName: 'Mona Manager' });
    expect(await count(sql`select coalesce(sum(amount_cents),0)::int as n from payment_refunds where tenant_id = ${T} and payment_id = ${PAY} and status = 'refunded'`)).toBe(8_000);
    expect(await count(sql`select count(*)::int as n from payments where tenant_id = ${T} and status = 'refunded' and amount_cents = 8000`)).toBe(1);
    await expect(engine.decide(mgr, live.id, { decision: 'approve', expectedVersion: done.version })).rejects.toMatchObject({ code: 'not_pending', status: 409 });
    expect(await engine.execute(mgr, live.id)).toBe(false);
    expect(await count(sql`select count(*)::int as n from payments where tenant_id = ${T} and status = 'refunded'`)).toBe(1);
    for (const t of ['approval.requested', 'approval.decided', 'approval.executed']) expect(await count(sql`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = ${t} and aggregate_id = ${live.id}`)).toBe(1);
    // the checkout audit is persisted fire-and-forget (checkout.service log()) — give it a moment
    let audited = 0;
    for (let i = 0; i < 20 && !audited; i++) { audited = await count(sql`select count(*)::int as n from audit_logs where tenant_id = ${T} and action_type = 'pos_checkout_refund_created' and user_id = ${MGR} and metadata_json::text like ${'%' + live.id + '%'}`); if (!audited) await new Promise((r) => setTimeout(r, 25)); }
    expect(audited).toBe(1);
  });
  it('a refund clerk (refund key, no approval key) past the SALON\'s limit gets approval_pending — not a 403; under a raised limit it refunds directly', async () => {
    const clerk = actor(CLERK, 'FRONT_DESK', ['checkout.manage_overrides']);
    const r: any = await checkout.refund(clerk, PAY2, { reason: 'Customer unhappy', amountCents: 6_000 });
    expect(r).toMatchObject({ status: 'approval_pending' });
    expect((await engine.get(own, r.approvalId))).toMatchObject({ kind: 'refund', amountCents: 6_000, requestedByUserId: CLERK });
    await engine.cancel(clerk, r.approvalId, { reason: 'owner will raise the limit' });
    const p = (await engine.policies(own)).find((x) => x.kind === 'refund')!;
    await engine.updatePolicy(own, { kind: 'refund', expectedVersion: p.version, cashThresholdCents: 7_000, reason: 'trusted front desk' });
    expect(await checkout.refund(clerk, PAY2, { reason: 'Customer unhappy', amountCents: 6_000 })).toMatchObject({ status: 'refunded' });
  });
});

describe('purchase orders — on the engine', () => {
  const newPo = () => inventory.createPurchaseOrder(mgr as any, { lines: [{ productId: PROD, quantityOrdered: 2, unitCostCents: 1_250 }], notes: 'restock gel' });
  it('a new PO files a request (every PO by default) and the approve route decides THROUGH it', async () => {
    const po: any = await newPo();
    expect(po.approvalId).toBeTruthy();
    expect(await engine.get(own, po.approvalId)).toMatchObject({ kind: 'purchase_order', amountCents: 2_500, status: 'pending', subjectId: po.id });
    const out: any = await inventory.approvePurchaseOrder(mgr as any, po.id);   // same manager: allowed by default (today's behaviour)
    expect(out.purchaseOrder.status).toBe('approved');
    expect((await engine.get(own, po.approvalId)).status).toBe('executed');
  });
  it('separation of duties when the salon turns it on: the creator cannot approve; another manager can', async () => {
    const p = (await engine.policies(own)).find((x) => x.kind === 'purchase_order')!;
    await engine.updatePolicy(own, { kind: 'purchase_order', expectedVersion: p.version, requireDifferentApprover: true, reason: 'two people on spend' });
    const po: any = await newPo();
    await expect(inventory.approvePurchaseOrder(mgr as any, po.id)).rejects.toMatchObject({ status: 403 });
    expect(((await inventory.approvePurchaseOrder(mgr2 as any, po.id)) as any).purchaseOrder.status).toBe('approved');
  });
  it('a rejection cancels the PO, so it cannot be approved around the decision', async () => {
    const po: any = await newPo();
    await engine.decide(mgr2, po.approvalId, { decision: 'reject', note: 'over budget', expectedVersion: 1 });
    const r: any = await inventory.getPurchaseOrder(mgr as any, po.id);
    expect(r.purchaseOrder.status).toBe('cancelled');
    await expect(inventory.approvePurchaseOrder(mgr2 as any, po.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('deal approvals — on the engine', () => {
  it('submit files the request; the deals approve route decides through it', async () => {
    const d = await deals.createDeal(mgr as any, { ownerType: 'salon', title: 'Fall Gel', discountType: 'percent', discountPercent: 10 } as any);
    await deals.submit(mgr as any, d.id);
    const live = await engine.liveFor(own, 'deal_publish', 'deal', d.id);
    expect(live).toMatchObject({ status: 'pending', title: 'Deal: Fall Gel', requestedByUserId: MGR });
    expect((await deals.approve(own as any, d.id, 'go')).status).toBe('approved');
    expect((await engine.get(own, live!.id)).status).toBe('executed');
  });
});
