/**
 * payroll-self.service.ts — the TECHNICIAN's own payroll reads + earnings questions (Payroll mandate §85–§89, §104,
 * §152–§153; wave 2 Oct 12 2026). Every method takes the technician id the Tech App resolved from the SESSION
 * (TechService.requireTechnician) — never a client-supplied id — and reads only that technician's rows (§189: Technician
 * A can never read Technician B). A manager's private note on an inquiry is never returned here (§153).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { ymdOf } from './payroll.dto';

export interface TechPayoutView { id: string; periodId: string; periodLabel: string | null; periodStart: string; periodEnd: string; amountCents: number; method: string; status: string; paidAt: string | null; createdAt: string }
export interface TechInquiryView { id: string; periodId: string | null; subjectType: string; subjectId: string | null; message: string; status: string; response: string | null; respondedAt: string | null; createdAt: string }
const d10 = ymdOf;

export class PayrollSelfService {
  constructor(private readonly db: Kysely<DB>) {}

  /** §89 payout history: what was actually paid, per period (never another technician's). */
  async payouts(tenantId: string, technicianId: string): Promise<TechPayoutView[]> {
    const rows = await this.db.selectFrom('payroll_payouts as o').innerJoin('payroll_periods as p', (j) => j.onRef('p.id', '=', 'o.period_id').onRef('p.tenant_id', '=', 'o.tenant_id'))
      .select(['o.id', 'o.period_id', 'p.label', 'p.period_start', 'p.period_end', 'o.amount_cents', 'o.method', 'o.status', 'o.paid_at', 'o.created_at'])
      .where('o.tenant_id', '=', tenantId).where('o.technician_id', '=', technicianId).orderBy('o.created_at', 'desc').limit(200).execute();
    return (rows as any[]).map((r) => ({ id: r.id, periodId: r.period_id, periodLabel: r.label ?? null, periodStart: d10(r.period_start), periodEnd: d10(r.period_end), amountCents: Number(r.amount_cents),
      method: r.method, status: r.status, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() }));
  }

  /** Paid cents per period for this technician (status 'paid' only) — the Tech App's Paid / Unpaid split (§78). */
  async paidByPeriod(tenantId: string, technicianId: string): Promise<Map<string, number>> {
    const rows = await this.db.selectFrom('payroll_payouts').select(['period_id', sql<number>`sum(amount_cents)`.as('paid')])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).where('status', '=', 'paid').groupBy('period_id').execute();
    return new Map((rows as any[]).map((r) => [String(r.period_id), Number(r.paid || 0)]));
  }

  async inquiries(tenantId: string, technicianId: string): Promise<TechInquiryView[]> {
    const rows = await this.db.selectFrom('payroll_inquiries').select(['id', 'period_id', 'subject_type', 'subject_id', 'message', 'status', 'response', 'responded_at', 'created_at'])
      .where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId).orderBy('created_at', 'desc').limit(100).execute();
    return (rows as any[]).map((r) => ({ id: r.id, periodId: r.period_id ?? null, subjectType: r.subject_type, subjectId: r.subject_id ?? null, message: r.message, status: r.status,
      response: r.response ?? null, respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() }));
  }

  /** §152: ask about an earning. The technician cannot change any financial entry — she can only ask. A period, if given,
   *  must be one of HER periods in this salon (a line exists for her). */
  async createInquiry(tenantId: string, branchId: string | null, technicianId: string, userId: string | null, b: { message: string; periodId?: string | null; subjectType?: string | null; subjectId?: string | null }): Promise<TechInquiryView> {
    const message = String(b.message ?? '').trim();
    if (message.length < 3 || message.length > 1000) throw Object.assign(new Error('Write your question (3–1000 characters).'), { status: 400 });
    const subjectType = ['period', 'ticket', 'adjustment', 'payout', 'other'].includes(String(b.subjectType)) ? String(b.subjectType) : (b.periodId ? 'period' : 'other');
    if (b.periodId) {
      const mine = await this.db.selectFrom('payroll_lines').select(['id']).where('tenant_id', '=', tenantId).where('period_id', '=', b.periodId).where('technician_id', '=', technicianId).executeTakeFirst();
      if (!mine) throw Object.assign(new Error('That pay period is not one of yours.'), { status: 404 });
    }
    const uuid = /^[0-9a-f-]{36}$/i;
    const r = await this.db.insertInto('payroll_inquiries').values({ tenant_id: tenantId, branch_id: branchId, technician_id: technicianId, period_id: b.periodId ?? null, subject_type: subjectType,
      subject_id: b.subjectId && uuid.test(b.subjectId) ? b.subjectId : null, message, created_by: userId, updated_by: userId } as any)
      .returning(['id', 'period_id', 'subject_type', 'subject_id', 'message', 'status', 'response', 'responded_at', 'created_at']).executeTakeFirstOrThrow();
    return { id: r.id, periodId: (r as any).period_id ?? null, subjectType: (r as any).subject_type, subjectId: (r as any).subject_id ?? null, message: (r as any).message, status: (r as any).status,
      response: null, respondedAt: null, createdAt: new Date((r as any).created_at).toISOString() };
  }
}
