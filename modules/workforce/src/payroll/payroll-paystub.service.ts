/**
 * payroll-paystub.service.ts — reads ONE approved, locked pay statement and everything the stub prints beside it, then
 * renders the PDF (payroll-paystub.ts). Weekly Paycheck mandate 17.5 (Oct 27 2026).
 *
 * Authorization is the caller's (PayrollPaycheckService.payStub / myPayStub): the technician reaches only her own
 * statement; a manager / owner reaches a statement exactly as the statement read does (tenant + branch scope). This file
 * only reads — it never writes and never recalculates:
 *   • the money: the statement row's stored columns (payroll_statements — the snapshot written at calculate and locked at
 *     approval; a later adjustment lands on a later statement, never on this one);
 *   • the hours: the locked payroll line's clocked minutes (payroll_lines.worked_minutes, the line the statement hashes);
 *   • year to date: the SAME stored columns summed over the technician's approved statements of the pay period's year
 *     through this period;
 *   • the payouts: payroll_payouts of the statement as they stand now (check # / cash and their status).
 * A one-week stub is ~30–40 KB and renders in a few tens of milliseconds (measured in payroll-paystub.pgtest), so it is
 * built on request — no document worker.
 */
import { sql, type Kysely } from 'kysely';
import { contentDisposition } from '@aipowersalon/security';
import type { DB } from '@aipowersalon/database';
import type { PayrollContext } from './payroll.repository';
import { ymdOf } from './payroll.dto';
import { renderPayStubPdf, payStubFilename, payStubLang, type PayStubData, type PayStubFigures, type PayStubLang } from './payroll-paystub';

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const APPROVED = ['locked', 'issued', 'partially_paid', 'paid'];

export interface PayStubFile { filename: string; contentType: 'application/pdf'; buffer: Buffer; language: PayStubLang; statementNumber: string; version: number }

/** the figures of one statement row (snake_case columns → the stub's figures) */
export function figuresOfStatement(s: Row, workedMinutes: number): PayStubFigures {
  return {
    serviceCommissionCents: n(s.service_commission_cents), retailCommissionCents: n(s.retail_commission_cents), cardTipCents: n(s.card_tip_cents), cashTipCents: n(s.cash_tip_cents),
    tipsCents: n(s.tips_cents), hourlyPayCents: n(s.hourly_pay_cents), salaryPayCents: n(s.salary_pay_cents), bonusCents: n(s.bonus_cents), guaranteeTopUpCents: n(s.guarantee_topup_cents),
    positiveAdjustmentsCents: n(s.positive_adjustments_cents), deductionsCents: n(s.deductions_cents), reversalsCents: n(s.reversals_cents), refundReversalCents: n(s.refund_reversal_cents),
    tipAdjustmentCents: n(s.tip_adjustment_cents), retailReversalCents: n(s.retail_reversal_cents), grossEarningsCents: n(s.gross_earnings_cents), alreadyPaidCents: n(s.already_paid_cents),
    approvedPayableCents: n(s.approved_payable_cents), workedMinutes: Math.max(0, n(workedMinutes)),
  };
}

/** Everything the stub shows, read from the database for statement row `s` (already authorized by the caller). */
export async function payStubData(db: Kysely<DB>, ctx: PayrollContext, s: Row, opts: { now: Date }): Promise<PayStubData> {
  const tenantId = ctx.tenantId;
  const techId = String(s.technician_id), periodId = String(s.period_id);
  const [period, tenant, tech, line] = await Promise.all([
    db.selectFrom('payroll_periods').select(['label', 'period_start', 'period_end', 'pay_date']).where('tenant_id', '=', tenantId).where('id', '=', periodId).executeTakeFirst(),
    db.selectFrom('tenants').select(['display_name']).where('id', '=', tenantId).executeTakeFirst(),
    db.selectFrom('technicians').select(['id', 'full_name', 'branch_id']).where('tenant_id', '=', tenantId).where('id', '=', techId).executeTakeFirst(),
    db.selectFrom('payroll_lines').select(['worked_minutes']).where('tenant_id', '=', tenantId).where('period_id', '=', periodId).where('technician_id', '=', techId).executeTakeFirst(),
  ]);
  const branchId = (s.branch_id as string | null) ?? (tech?.branch_id as string | null) ?? null;
  const branch = branchId ? await db.selectFrom('branches').select(['name', 'address', 'city', 'state', 'zip', 'timezone']).where('tenant_id', '=', tenantId).where('id', '=', branchId).executeTakeFirst() : undefined;
  const periodEnd = ymdOf(period?.period_end ?? null);
  const year = Number(periodEnd.slice(0, 4)) || opts.now.getUTCFullYear();
  // year to date: the stored columns of the technician's approved statements whose pay period ends in this year, up to
  // and including this one (the hours: their locked lines' clocked minutes)
  const ytdRow = periodEnd ? (await sql<Record<string, string>>`
      SELECT count(*)::text AS statements,
        COALESCE(SUM(s.service_commission_cents),0)::text AS service_commission_cents, COALESCE(SUM(s.retail_commission_cents),0)::text AS retail_commission_cents,
        COALESCE(SUM(s.card_tip_cents),0)::text AS card_tip_cents, COALESCE(SUM(s.cash_tip_cents),0)::text AS cash_tip_cents, COALESCE(SUM(s.tips_cents),0)::text AS tips_cents,
        COALESCE(SUM(s.hourly_pay_cents),0)::text AS hourly_pay_cents, COALESCE(SUM(s.salary_pay_cents),0)::text AS salary_pay_cents, COALESCE(SUM(s.bonus_cents),0)::text AS bonus_cents,
        COALESCE(SUM(s.guarantee_topup_cents),0)::text AS guarantee_topup_cents, COALESCE(SUM(s.positive_adjustments_cents),0)::text AS positive_adjustments_cents,
        COALESCE(SUM(s.deductions_cents),0)::text AS deductions_cents, COALESCE(SUM(s.reversals_cents),0)::text AS reversals_cents, COALESCE(SUM(s.refund_reversal_cents),0)::text AS refund_reversal_cents,
        COALESCE(SUM(s.tip_adjustment_cents),0)::text AS tip_adjustment_cents, COALESCE(SUM(s.retail_reversal_cents),0)::text AS retail_reversal_cents,
        COALESCE(SUM(s.gross_earnings_cents),0)::text AS gross_earnings_cents, COALESCE(SUM(s.already_paid_cents),0)::text AS already_paid_cents,
        COALESCE(SUM(s.approved_payable_cents),0)::text AS approved_payable_cents,
        COALESCE(SUM((SELECT l.worked_minutes FROM payroll_lines l WHERE l.tenant_id = s.tenant_id AND l.period_id = s.period_id AND l.technician_id = s.technician_id)),0)::text AS worked_minutes
      FROM payroll_statements s JOIN payroll_periods p ON p.id = s.period_id AND p.tenant_id = s.tenant_id
      WHERE s.tenant_id = ${tenantId} AND s.technician_id = ${techId} AND s.status IN (${sql.join(APPROVED)})
        AND p.period_end >= ${`${year}-01-01`} AND p.period_end <= ${periodEnd}`.execute(db)).rows[0] : undefined;
  const ytdCount = n(ytdRow?.statements);
  // in the order the plan lists them (check first on the default split), then a later payout (a replacement check) after
  const payouts = await db.selectFrom('payroll_payouts as x').leftJoin('payroll_payout_instructions as i', (j) => j.onRef('i.id', '=', 'x.instruction_id').onRef('i.tenant_id', '=', 'x.tenant_id'))
    .select(['x.method', 'x.amount_cents', 'x.status', 'x.check_number', 'x.check_status', 'x.cash_status', 'x.cash_source', 'x.paid_at'])
    .where('x.tenant_id', '=', tenantId).where('x.statement_id', '=', String(s.id)).where('x.technician_id', '=', techId)
    .orderBy('x.created_at').orderBy(sql`COALESCE(i.sequence, 2147483647)`).orderBy('x.id').execute();
  const address = branch ? [branch.address, [branch.city, [branch.state, branch.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ') : '';
  const paid = n(s.paid_cents), payable = n(s.approved_payable_cents);
  return {
    salon: { name: String(tenant?.display_name ?? ''), branchName: (branch?.name as string) ?? null, address: address || null },
    technician: { id: techId, name: String(tech?.full_name ?? ''), reference: `T-${techId.replace(/-/g, '').slice(0, 8).toUpperCase()}` },
    statement: { id: String(s.id), number: String(s.statement_number), version: n(s.version) || 1, status: String(s.status), approvedAt: iso(s.approved_at),
      periodLabel: (period?.label as string) ?? null, periodStart: ymdOf(period?.period_start ?? null), periodEnd, payDate: period?.pay_date ? ymdOf(period.pay_date) : null },
    figures: figuresOfStatement(s, n(line?.worked_minutes)),
    ytd: ytdCount > 0 ? { ...figuresOfStatement(ytdRow as Row, n(ytdRow?.worked_minutes)), year, statements: ytdCount } : null,
    payouts: payouts.map((x) => ({ method: String(x.method), amountCents: n(x.amount_cents), status: String(x.status), checkNumber: (x.check_number as string) ?? null, checkStatus: (x.check_status as string) ?? null,
      cashStatus: (x.cash_status as string) ?? null, cashSource: (x.cash_source as string) ?? null, paidAt: iso(x.paid_at) })),
    paidCents: paid, unpaidCents: Math.max(0, payable - paid),
    generatedAt: opts.now.toISOString(), timeZone: String(branch?.timezone ?? 'UTC'),
  };
}

/** The language of the stub: the one asked for (the app's current language), else the signed-in person's, else the
 *  technician's, else English. */
export async function payStubLanguage(db: Kysely<DB>, ctx: PayrollContext, technicianId: string, asked?: string | null): Promise<PayStubLang> {
  if (asked && /^(en|vi)/i.test(asked)) return payStubLang(asked);
  const uuid = /^[0-9a-f-]{36}$/i;
  const me = ctx.userId && uuid.test(ctx.userId) ? await db.selectFrom('users').select(['preferred_language']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.userId).executeTakeFirst() : undefined;
  if (me?.preferred_language) return payStubLang(me.preferred_language);
  const t = await db.selectFrom('technicians as t').innerJoin('users as u', (j) => j.onRef('u.id', '=', 't.user_id').onRef('u.tenant_id', '=', 't.tenant_id')).select(['u.preferred_language']).where('t.tenant_id', '=', ctx.tenantId).where('t.id', '=', technicianId).executeTakeFirst();
  return payStubLang(t?.preferred_language ?? 'en');
}

/** read + render: the file the route sends */
export async function buildPayStub(db: Kysely<DB>, ctx: PayrollContext, s: Row, opts: { now: Date; lang?: string | null }): Promise<PayStubFile> {
  const [data, language] = await Promise.all([payStubData(db, ctx, s, { now: opts.now }), payStubLanguage(db, ctx, String(s.technician_id), opts.lang)]);
  const buffer = await renderPayStubPdf(data, language);
  return { filename: payStubFilename(data.statement.number), contentType: 'application/pdf', buffer, language, statementNumber: data.statement.number, version: data.statement.version };
}

/** The response headers of a pay-stub download (POS, Owner and Tech routes): an attachment, never cached anywhere — the
 *  stub carries a person's pay (PII) — and never sniffed into something else. */
export function payStubHeaders(f: { filename: string; contentType: string; buffer: Buffer }): Record<string, string> {
  return {
    'Content-Type': f.contentType, 'Content-Disposition': contentDisposition(f.filename, 'attachment'), 'Content-Length': String(f.buffer.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0', Pragma: 'no-cache', Expires: '0', 'X-Content-Type-Options': 'nosniff',
  };
}
