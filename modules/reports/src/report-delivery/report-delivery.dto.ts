// report-delivery.dto.ts — Daily Summary "Email Report" / "Schedule Report" (batch 9 decision 1, Nov 10 2026). Pure: the
// period a scheduled send covers, whether it is due, and the e-mail itself. English only (e-mail is English platform-wide).
// Money is integer cents; the figures are the Sales Report's own (ReportsService.getSales) — nothing is recomputed here.
import type { SalesKpis } from '../reports/reports.dto';
import { addDays } from '@aipowersalon/date-time';
import { defineStateMachine } from '@aipowersalon/database';

export type ReportFrequency = 'daily' | 'weekly';
export const REPORT_FREQUENCIES: readonly ReportFrequency[] = ['daily', 'weekly'];
/** whole hours only — the scheduler checks hourly */
export const SEND_AT_RE = /^([01][0-9]|2[0-3]):00$/;
/** one person may e-mail themselves the report at most this many times an hour (Email Report button) */
export const SEND_NOW_PER_HOUR = 5;

/** report_email_deliveries.status — an attempt is recorded 'pending' and finished exactly once with its honest outcome */
export const REPORT_EMAIL_DELIVERY = defineStateMachine({
  name: 'report_email_delivery', table: 'report_email_deliveries', column: 'status',
  states: ['pending', 'sent', 'simulated', 'failed', 'not_configured', 'skipped'],
  transitions: { pending: ['sent', 'simulated', 'failed', 'not_configured', 'skipped'], sent: [], simulated: [], failed: [], not_configured: [], skipped: [] },
  initial: ['pending'],
});

export interface DeliveryStatus { status: 'sent' | 'simulated' | 'failed' | 'not_configured' | 'skipped'; detail: string | null }

const ymdIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
export { addDays };   // §87: the one calendar helper

/** The salon days a scheduled send covers, decided on the salon's calendar at `now`:
 *  daily = yesterday; weekly = the last full Monday–Sunday week (sent on Mondays). null = not a send day. */
export function scheduledPeriod(frequency: ReportFrequency, now: Date, tz: string): { from: string; to: string } | null {
  const today = ymdIn(now, tz);
  if (frequency === 'daily') { const y = addDays(today, -1); return { from: y, to: y }; }
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();   // 0 Sun … 1 Mon
  if (dow !== 1) return null;
  return { from: addDays(today, -7), to: addDays(today, -1) };
}

/** due = a send day, at or after the salon-local send hour; the occurrence key makes the send happen once */
export function dueOccurrence(sub: { id: string; frequency: ReportFrequency; sendAt: string }, now: Date, tz: string): { from: string; to: string; key: string } | null {
  const p = scheduledPeriod(sub.frequency, now, tz);
  if (!p) return null;
  const hour = Number(sub.sendAt.slice(0, 2));
  if (!Number.isFinite(hour) || hourIn(now, tz) < hour) return null;
  return { ...p, key: `${sub.id}:${p.to}` };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const usd = (cents: number) => (cents < 0 ? '-' : '') + '$' + (Math.abs(Math.trunc(cents)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const periodLabel = (from: string, to: string) => (from === to ? longDay(from) : `${longDay(from)} – ${longDay(to)}`);

/** The e-mail: subject + a small branded HTML table of the Sales Report's figures for the period. */
export function renderDailySummaryEmail(input: { salonName: string; from: string; to: string; kpis: SalesKpis; scheduled: boolean }): { subject: string; html: string } {
  const k = input.kpis;
  const rows: [string, string][] = [
    ['Gross sales', usd(k.grossSalesCents)], ['Net sales', usd(k.netSalesCents)], ['Service sales', usd(k.serviceSalesCents)], ['Product sales', usd(k.productSalesCents)],
    ['Tips', usd(k.tipsCents)], ['Tax collected', usd(k.taxCollectedCents)], ['Discounts', usd(k.discountsCents)], ['Refunds', usd(k.refundsCents)],
    ['Tickets', String(k.ticketsCount)], ['Customers', String(k.customersCount)], ['Average ticket', k.ticketsCount > 0 ? usd(k.averageTicketCents) : 'N/A'],
  ];
  const period = periodLabel(input.from, input.to);
  const subject = `${input.salonName || 'Your salon'} — Daily Summary, ${period}`.replace(/[\r\n]/g, ' ');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#2b2118;background:#faf6f0;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eadfcd;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 4px">${esc(input.salonName || 'Your salon')} · Daily Summary</h1>
<div style="color:#7a6a58;font-size:14px;margin-bottom:16px">${esc(period)} (salon days)</div>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([l, v]) => `<tr><td style="padding:6px 0;border-bottom:1px solid #f1e8da">${esc(l)}</td><td style="padding:6px 0;border-bottom:1px solid #f1e8da;text-align:right;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>
<p style="color:#7a6a58;font-size:12px;margin-top:16px">The same figures as POS → Reports for this period. ${input.scheduled
    ? 'You receive this because you turned on Schedule Report in POS → Reports. Turn it off there at any time.'
    : 'You asked for this from Email Report in POS → Reports.'}</p>
</div></body></html>`;
  return { subject, html };
}
