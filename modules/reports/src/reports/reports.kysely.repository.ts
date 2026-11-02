// reports.kysely.repository.ts — production ReportsRepositoryPort over Postgres (Kysely).
// Loads a REAL, tenant/branch-scoped transaction list from payments ⨝ tickets (+ ticket_service_lines for the
// service/category, customers for the name, technicians for the name) and then runs the SAME shared pure builders
// (buildReportsState / buildExportRows) the in-memory adapter uses — so every KPI, trend, breakdown, transaction row,
// and CSV export is computed by identical, honest math. Server-side filters are applied by the shared builder.
//
// Honest fallbacks (documented — no schema source per transaction, so NOT faked): cardSurcharge is 0 (the payments
// table has no surcharge column), customerType defaults to 'returning', and bookingSource defaults to 'walk_in'.
// gift_card is normalized to the builder's 'giftCard' bucket; refunded/voided payment statuses map to 'refunded'.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReportFilters } from './reports.dto';
import { ReportsContext, ReportsRepositoryPort, Tx, buildReportsState, buildExportRows, daysAgo, attributeCardSurcharge } from './reports.repository';
import { REPORTABLE_PAYMENT_STATUSES, isRefundStatus } from '@aipowersalon/api-contracts';

const dateOnly = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const normMethod = (m: string) => (m === 'gift_card' ? 'giftCard' : m === 'gift' ? 'giftCard' : m || 'card');
const isRefund = isRefundStatus; // shared single source of truth (was a duplicated local list)

export class KyselyReportsRepository implements ReportsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  private scoped(qb: any, ctx: ReportsContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }

  // build the real transaction list (a generous window; the shared builder re-applies the precise filters)
  private async loadTx(ctx: ReportsContext, filters: ReportFilters): Promise<Tx[]> {
    const from = filters.from || daysAgo(400);
    const to = filters.to || daysAgo(0);
    const pays = await this.scoped(this.db.selectFrom('payments'), ctx)
      .where((eb: any) => eb.between(sqlDate(eb, 'created_at'), from, to))
      // only revenue-bearing rows: a declined / not_configured / voided / pending payment collected nothing and must
      // never count toward reported sales. Refunds are kept (they net out as refundsCents in the summary).
      .where('status', 'in', [...REPORTABLE_PAYMENT_STATUSES])
      .select(['id', 'ticket_id', 'method', 'amount_cents', 'tip_cents', 'tax_cents', 'discount_cents', 'surcharge_cents', 'status', 'created_at'])
      .execute().catch(() => []);
    if (!pays.length) return [];
    const ticketIds = [...new Set(pays.map((p: any) => p.ticket_id).filter(Boolean))];
    const tickets = ticketIds.length ? await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', 'in', ticketIds).select(['id', 'customer_id', 'primary_technician_id', 'surcharge_cents', 'tax_cents', 'discount_cents', 'tip_cents']).execute().catch(() => []) : [];
    const tById: Record<string, any> = {}; for (const t of tickets) tById[t.id] = t;
    const custIds = [...new Set(tickets.map((t: any) => t.customer_id).filter(Boolean))];
    const techIds = [...new Set(tickets.map((t: any) => t.primary_technician_id).filter(Boolean))];
    const custs = custIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'full_name']).execute().catch(() => []) : [];
    const techs = techIds.length ? await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => []) : [];
    const cName: Record<string, string> = {}; for (const c of custs) cName[c.id] = c.full_name || '';
    const tName: Record<string, string> = {}; for (const t of techs) tName[t.id] = t.full_name || '';
    // one representative service line per ticket (for service name + category)
    const lines = ticketIds.length ? await this.scoped(this.db.selectFrom('ticket_service_lines as l'), ctx, 'l').leftJoin('services as s', 's.id', 'l.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('l.ticket_id', 'in', ticketIds).select(['l.ticket_id as ticketId', 'l.service_name_snapshot as svcName', 'c.name as cat']).execute().catch(() => []) : [];
    const lineByTicket: Record<string, { svcName: string; cat: string }> = {};
    for (const l of lines) if (!lineByTicket[l.ticketId]) lineByTicket[l.ticketId] = { svcName: l.svcName || 'Service', cat: l.cat || 'General' };
    // wave 4 PILOT: each ticket's SALES (service + retail lines, before discounts) and its retail part — from the lines
    const money = ticketIds.length ? await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', 'in', ticketIds).where('removed_at', 'is', null)
      .select(['ticket_id', 'line_total_cents', 'product_id', 'line_kind']).execute().catch(() => []) : [];
    const salesByTicket: Record<string, { sales: number; product: number }> = {};
    for (const m of money) {
      const c = salesByTicket[m.ticket_id] || { sales: 0, product: 0 }; const v = Number(m.line_total_cents || 0);
      c.sales += v; if (m.product_id || String(m.line_kind || '').toLowerCase() === 'retail') c.product += v; salesByTicket[m.ticket_id] = c;
    }
    // ONE payment row per ticket carries the ticket's own figures (its first revenue row), so a split ticket is counted once
    const carrier: Record<string, string> = {};
    for (const p of [...pays].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) if (p.ticket_id && !isRefund(p.status) && !carrier[p.ticket_id]) carrier[p.ticket_id] = p.id;

    // The surcharge a card row CHARGED is on that row (payments.surcharge_cents — recorded on every path since wave 4); the
    // older ticket-level attribution only ever saw split payments. A refund row carries none.
    const surchargeById: Record<string, number> = Object.fromEntries(pays.map((p: any) => [p.id, isRefund(p.status) ? 0 : Number(p.surcharge_cents || 0)]));
    void attributeCardSurcharge;
    return pays.map((p: any): Tx => {
      const t = tById[p.ticket_id] || {};
      const line = lineByTicket[p.ticket_id] || { svcName: 'Service', cat: 'General' };
      const techId = t.primary_technician_id || '';
      const custId = t.customer_id || '';
      return {
        id: p.id, ticketId: p.ticket_id || null, at: dateOnly(p.created_at), customerId: custId, customer: cName[custId] || '', customerType: 'returning',
        technicianId: techId, technician: tName[techId] || '', service: line.svcName, category: line.cat, paymentMethod: normMethod(p.method),
        bookingSource: 'walk_in', grossCents: Number(p.amount_cents || 0), surchargeCents: surchargeById[p.id] || 0, status: isRefund(p.status) ? 'refunded' : 'completed',
        // the ticket's own discount / tax / tip / sales ride on its ONE carrier row (payments rows never carried tax or
        // discounts, and a split's tip is on the ticket, not on a card row) — wave 4 PILOT
        ...(p.ticket_id && carrier[p.ticket_id] === p.id
          ? { discountCents: Number(t.discount_cents || 0), taxCents: Number(t.tax_cents || 0), tipCents: Number(t.tip_cents || 0), salesCents: salesByTicket[p.ticket_id]?.sales ?? Number(p.amount_cents || 0), productCents: salesByTicket[p.ticket_id]?.product ?? 0 }
          : p.ticket_id ? { discountCents: 0, taxCents: 0, tipCents: 0, salesCents: 0, productCents: 0 }
          : { discountCents: Number(p.discount_cents || 0), taxCents: Number(p.tax_cents || 0), tipCents: Number(p.tip_cents || 0) }),
      };
    });
  }

  async query(ctx: ReportsContext, filters: ReportFilters) {
    const out = buildReportsState(await this.loadTx(ctx, filters), filters, ctx.branchId);
    await this.overlayFacts(ctx, out).catch(() => undefined);
    return out;
  }

  /** wave 4 PILOT: the facts the pure builder cannot know — never invented. Tips by technician are the compensation
   *  snapshot's allocation (the payroll authority: a split ticket's tip is split); the tax rate and the card-surcharge %
   *  are the salon's settings; the processor status is the salon's gateway status. */
  private async overlayFacts(ctx: ReportsContext, out: { state: any; rows: any[] }): Promise<void> {
    const s = out.state;
    const ticketIds = [...new Set((out.rows || []).filter((r: any) => r.status !== 'refunded' && r.ticketId).map((r: any) => String(r.ticketId)))];
    if (ticketIds.length) {
      const tips: any[] = await this.db.selectFrom('ticket_compensation_snapshots as s').leftJoin('technicians as t', 't.id', 's.technician_id')
        .where('s.tenant_id', '=', ctx.tenantId).where('s.ticket_id', 'in', ticketIds).where('s.technician_id', 'is not', null)
        .select(['s.technician_id as id', 't.full_name as name', (eb: any) => eb.fn.sum(eb('s.card_tip_cents', '+', eb.ref('s.cash_tip_cents'))).as('tips')])
        .groupBy(['s.technician_id', 't.full_name']).execute();
      if (tips.length) s.tips.byTechnician = tips.map((x) => ({ technicianId: String(x.id), name: String(x.name ?? ''), tipsCents: Number(x.tips || 0) })).sort((a, b) => b.tipsCents - a.tipsCents);
    }
    const setting = async (category: string): Promise<any> => {
      const rows: any[] = await this.db.selectFrom('tenant_settings').where('tenant_id', '=', ctx.tenantId).where('category', '=', category)
        .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || null), eb('branch_id', 'is', null)])).select(['branch_id', 'settings_json']).execute();
      const pick = rows.find((r) => r.branch_id && r.branch_id === ctx.branchId) ?? rows.find((r) => !r.branch_id);
      const j = pick?.settings_json; return typeof j === 'string' ? JSON.parse(j) : j ?? null;
    };
    const tax = await setting('tax'); if (tax && Number.isFinite(Number(tax.taxRatePercent))) s.tax.taxRatePercent = Number(tax.taxRatePercent);
    const pc = await setting('payments-checkout');
    if (pc && Number.isFinite(Number(pc.creditCardSurchargePercent))) s.discountSurcharge.surchargePercent = pc.creditCardSurchargeEnabled === false ? 0 : Number(pc.creditCardSurchargePercent);
    const gw: any = await this.db.selectFrom('tenant_payment_config').where('tenant_id', '=', ctx.tenantId).select(['status']).executeTakeFirst();
    s.payments.processorStatus = String(gw?.status || 'not_configured');
  }
  async exportRows(ctx: ReportsContext, type: string, filters: ReportFilters) { return buildExportRows(await this.loadTx(ctx, filters), type, filters, ctx.branchId); }
}

// cast a TIMESTAMPTZ column to ::date for an inclusive day-range comparison
function sqlDate(eb: any, col: string) { return eb.fn('date', [eb.ref(col)]); }
