// reports-core.spec.ts — Nest-free harness for the (async) reports service + repository.
// Verifies isolation, server-side filters, permission gating, export safety, audit, honest math.
import { InMemoryReportsRepository, ReportsContext, Tx, buildReportsState, attributeCardSurcharge } from './reports.repository';
import { ReportsService, ForbiddenError } from './reports.service';
import { toCsv } from './reports.dto';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } };
const throwsAsync = async (name: string, fn: () => Promise<unknown>, type?: any) => { try { await fn(); fail++; console.error('FAIL (no throw):', name); } catch (e) { if (type && !(e instanceof type)) { fail++; console.error('FAIL (wrong type):', name); } else pass++; } };

const svc = () => new ReportsService(new InMemoryReportsRepository());
const owner = (over: Partial<ReportsContext> = {}): ReportsContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.reports.view', 'pos.reports.export', 'pos.reports.financial_view'], ...over });
const tech = (over: Partial<ReportsContext> = {}): ReportsContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_tech', role: 'TECHNICIAN', permissions: ['pos.reports.view'], ...over });

(async () => {
  // --- access / roles ---
  await throwsAsync('customer role blocked', () => svc().getState({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_c', role: 'CUSTOMER', permissions: ['pos.reports.view'] }), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_d', role: 'CUSTOMER_DISPLAY', permissions: ['pos.reports.view'] }), ForbiddenError);
  await throwsAsync('super_admin blocked from /pos/reports', () => svc().getState({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_s', role: 'SUPER_ADMIN', permissions: ['pos.reports.view'] }), ForbiddenError);
  await throwsAsync('missing pos.reports.view', () => svc().getState({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_x', role: 'FRONT_DESK', permissions: [] }), ForbiddenError);

  // --- tenant + branch isolation ---
  const otherTenant = await svc().getState({ tenantId: 'other999', branchId: 'br_x', userId: 'u', role: 'OWNER', permissions: ['pos.reports.view', 'pos.reports.financial_view'] });
  ok('tenant isolation: other tenant has zero gross', otherTenant.salesKpis.grossSalesCents === 0);
  ok('tenant isolation: other tenant has no tx', otherTenant.transactions.length === 0);
  const otherBranch = await svc().getState(owner(), { branchId: 'br_not_real' });
  ok('branch isolation: unknown branch → empty', otherBranch.salesKpis.ticketsCount === 0);

  // --- server-side filters genuinely change results ---
  const all = await svc().getState(owner(), {});
  const cardOnly = await svc().getState(owner(), { paymentMethod: 'card' });
  ok('filter paymentMethod=card reduces gross', cardOnly.salesKpis.grossSalesCents > 0 && cardOnly.salesKpis.grossSalesCents < all.salesKpis.grossSalesCents);
  ok('filter payments reflect card-only', cardOnly.payments.cashCents === 0);
  const techFilter = await svc().getState(owner(), { technicianId: 't_mia' });
  ok('filter technicianId narrows tx', techFilter.transactions.length > 0 && techFilter.transactions.length < all.transactions.length);
  ok('filter technicianId every row is mia', techFilter.transactions.every((t) => t.technician === 'Mia'));
  const search = await svc().getState(owner(), { search: 'Grace' });
  ok('filter search matches customer', search.transactions.length >= 1 && search.transactions.every((t) => /Grace/i.test(t.customer)));

  // --- honest math ---
  ok('averageTicket = gross / tickets', all.salesKpis.ticketsCount > 0 && all.salesKpis.averageTicketCents === Math.round(all.salesKpis.grossSalesCents / all.salesKpis.ticketsCount));
  ok('net = gross - discounts', all.salesKpis.netSalesCents === all.salesKpis.grossSalesCents - all.salesKpis.discountsCents);
  ok('refunds counted separately (refunded tx not in gross)', all.salesKpis.refundsCents > 0);

  // --- financial gating ---
  const techState = await svc().getState(tech(), {});
  ok('tech state lists restricted sections', techState.restrictedSections.includes('payments') && techState.restrictedSections.includes('salesKpis'));
  ok('tech state zeroes financial gross', techState.salesKpis.grossSalesCents === 0);
  ok('tech state keeps operational queue', techState.queue.walkIns >= 0 && techState.queue !== undefined);
  await throwsAsync('tech cannot GET payments', () => svc().getPayments(tech()), ForbiddenError);
  await throwsAsync('tech cannot GET tips', () => svc().getTips(tech()), ForbiddenError);
  await throwsAsync('tech cannot GET tax', () => svc().getTax(tech()), ForbiddenError);
  await throwsAsync('tech cannot GET transactions (financial)', () => svc().getTransactions(tech()), ForbiddenError);
  ok('owner CAN GET payments', (await svc().getPayments(owner())).cardCents > 0);
  await throwsAsync('tech cannot GET technicians without technician_view', () => svc().getTechnicians(tech()), ForbiddenError);
  ok('tech WITH technician_view can GET technicians', (await svc().getTechnicians(tech({ permissions: ['pos.reports.view', 'pos.reports.technician_view'] }))).length > 0);

  // --- export ---
  const csv = await svc().export(owner(), 'transactions', 'csv', {});
  ok('export returns csv', !!csv.csv && csv.format === 'csv');
  ok('export filename includes type', csv.filename.includes('transactions'));
  const pdf = await svc().export(owner(), 'sales', 'pdf', {});
  ok('pdf export shows disabled reason', !!pdf.disabledReason && !pdf.csv);
  await throwsAsync('export requires pos.reports.export', () => svc().export(owner({ permissions: ['pos.reports.view'] }), 'transactions', 'csv', {}), ForbiddenError);
  // CSV formula-injection safety
  const evil = toCsv(['A'], [['=SUM(A1:A9)'], ['+cmd'], ['@x'], ['-2'], ['normal']]);
  ok('csv neutralizes =formula', evil.includes("'=SUM"));
  ok('csv neutralizes +formula', evil.includes("'+cmd"));
  ok('csv neutralizes @formula', evil.includes("'@x"));

  // --- audit logs ---
  const s1 = svc();
  await s1.getState(owner(), { paymentMethod: 'card' });
  const a1 = s1.auditLog();
  ok('audit: pos_reports_viewed logged', a1.some((l) => l.actionType === 'pos_reports_viewed'));
  ok('audit: pos_reports_filter_changed logged', a1.some((l) => l.actionType === 'pos_reports_filter_changed'));
  await s1.export(owner(), 'transactions', 'csv', {});
  ok('audit: pos_reports_exported logged', s1.auditLog().some((l) => l.actionType === 'pos_reports_exported'));
  await s1.detail(owner(), 'transaction', 'tx1');
  ok('audit: pos_reports_detail_opened logged', s1.auditLog().some((l) => l.actionType === 'pos_reports_detail_opened'));
  ok('audit entries carry tenant + user', a1.every((l) => l.tenantId === 'luxe001' && !!l.userId));

  // --- detail ---
  ok('detail transaction found for owner', ((await svc().detail(owner(), 'transaction', 'tx1')) as any).row?.id === 'tx1');
  ok('detail unknown kind → not configured', ((await svc().detail(owner(), 'mystery', 'x')) as any).configured === false);

  // ---- card-surcharge attribution (no double-count for splits; revenue independent) ----
  {
    const A = attributeCardSurcharge([{ id: 'p1', ticketId: 'T1', isCard: true, isRefund: false }], { T1: 150 });
    ok('surcharge attribution: single card row credited', A.p1 === 150);
    const B = attributeCardSurcharge([{ id: 'c', ticketId: 'T2', isCard: true, isRefund: false }, { id: 'h', ticketId: 'T2', isCard: false, isRefund: false }], { T2: 90 });
    ok('surcharge attribution: split credits the card row only', B.c === 90 && B.h === 0);
    const C = attributeCardSurcharge([{ id: 'x', ticketId: 'T3', isCard: true, isRefund: false }, { id: 'y', ticketId: 'T3', isCard: true, isRefund: false }], { T3: 200 });
    ok('surcharge attribution: two card rows on one ticket → credited once', C.x === 200 && C.y === 0);
    const D = attributeCardSurcharge([{ id: 'r', ticketId: 'T4', isCard: true, isRefund: true }], { T4: 120 });
    ok('surcharge attribution: refund card row not credited', D.r === 0);
    const E = attributeCardSurcharge([{ id: 'z', ticketId: 'T5', isCard: true, isRefund: false }], { T5: 0 });
    ok('surcharge attribution: zero ticket surcharge → 0', E.z === 0);
    const F = attributeCardSurcharge([{ id: 'n', ticketId: null, isCard: true, isRefund: false }], {});
    ok('surcharge attribution: null ticket → 0', F.n === 0);
  }
  // revenue independence + breakout sum via the shared builder
  {
    const day = '2026-06-18';
    const mk = (id: string, method: string, gross: number, surcharge: number): Tx => ({
      id, at: day, customerId: 'c1', customer: 'C', customerType: 'returning', technicianId: 't1', technician: 'T',
      service: 'S', category: 'General', paymentMethod: method, bookingSource: 'walk_in', grossCents: gross,
      discountCents: 0, surchargeCents: surcharge, taxCents: 0, tipCents: 0, status: 'completed',
    });
    // T1 single card (gross 5000, incl. 150 surcharge); T2 split = card 3000 (incl. 90 surcharge) + cash 2000
    const rows = [mk('p1', 'card', 5000, 150), mk('p2', 'card', 3000, 90), mk('p3', 'cash', 2000, 0)];
    const { state } = buildReportsState(rows, { from: '2000-01-01', to: '2999-12-31' }, 'br1');
    ok('reports revenue = sum of gross, surcharge NOT added on top', state.kpis.totalRevenueCents === 10000);
    ok('reports card-surcharge breakout sums the attributed surcharge', state.salesKpis.cardSurchargeCents === 240);
  }

  console.log(`\nreports-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
