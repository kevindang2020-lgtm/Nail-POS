// billing-cycle.service.ts — the period-end subscription invoice GENERATOR (the piece REMAINING_ISSUES flagged as
// missing). Applies billing-cycle-core policy to every subscription whose current_period_end has passed:
//   invoice → writes a billing_invoices row for the next cycle + advances the period (+ converts a trial to active);
//   cancel  → sets status 'cancelled'/cancelled_at, no invoice;
//   skip    → past_due (dunning owns it), paused, or terminal.
// Safety (money path):
//   • each subscription is processed inside a transaction under pg_advisory_xact_lock(subscription id) — no two ticks
//     touch the same subscription at once;
//   • IDEMPOTENT — refuses to write a second invoice for a period that already has one (guard on
//     billing_invoices.period_start), so a re-run never double-bills;
//   • subscriptions are processed SEQUENTIALLY, so INV-YYYY-NNNN numbering has no cross-row race within a tick;
//   • never recomputes historical invoices — it only issues the NEXT one.
// Uses raw `sql` (like KyselyBillingRepository) because billing_invoices / subscription_plans and the later
// tenant_subscriptions columns are intentionally outside the generated Kysely types. Off by default (see the
// scheduler); ops trigger a pass via POST /super-admin/billing/cycle/run.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { decideRenewal, renewalAmountCents, advancePeriodEnd, type CycleSubscription } from './billing-cycle-core';
import { nextInvoiceNumber, invoiceSeq } from './billing-invoice-core';
import { canMoveToSql, assertTransition } from '@aipowersalon/database';
import { TENANT_SUBSCRIPTION } from '@aipowersalon/platform';

export interface CycleResult { due: number; invoiced: number; cancelled: number; skipped: number; errors: number; dryRun: boolean }

// Thrown at the end of a per-subscription transaction in dry-run mode to force a ROLLBACK — the preview runs the exact
// same code path (decisions, catch-up loop, writes) then discards it, so the reported counts match a real run byte for
// byte without persisting anything. Caught and treated as success, not an error.
class DryRunSignal extends Error {}

const DUE_DAYS = 14; // an issued subscription invoice is due 14 days out
// Catch-up ceiling per subscription per pass — bill EVERY missed cycle, but never loop unboundedly on corrupt/ancient
// data (e.g. a period_end stuck years in the past). Any cycles beyond the cap are billed on the next pass (idempotent).
const MAX_CATCHUP_CYCLES = 120;
const ms = (v: unknown): number | null => { if (v == null) return null; const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime(); return Number.isFinite(t) ? t : null; };
const isoDate = (msVal: number): string => new Date(msVal).toISOString().slice(0, 10);
const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);

@Injectable()
export class SuperAdminBillingCycleService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase) {}

  /** One pass. Processes up to `limit` due subscriptions. `nowMs` is injectable for tests. When `dryRun` is true it
   *  computes the full plan (same code path) but writes nothing — for previewing before a live run. */
  async runBillingCycle(nowMs: number = Date.now(), limit = 200, dryRun = false): Promise<CycleResult> {
    const res: CycleResult = { due: 0, invoiced: 0, cancelled: 0, skipped: 0, errors: 0, dryRun };
    const db: any = this.db;
    if (!db) return res;
    const nowIso = new Date(nowMs).toISOString();

    // Only fetch statuses the policy can act on; past_due/paused/expired/cancelled are always 'skip'.
    const due = rowsOf(await sql`
      SELECT id, tenant_id, status, plan, plan_code, current_period_end, monthly_price_cents, billing_interval, cancel_at
      FROM tenant_subscriptions
      WHERE current_period_end IS NOT NULL AND current_period_end <= ${nowIso}
        AND status IN ('active','trialing','pending_cancellation')
      ORDER BY current_period_end ASC LIMIT ${limit}
    `.execute(db).catch(() => ({ rows: [] })));
    res.due = due.length;

    for (const r of due) {
      try {
        await db.transaction().execute(async (trx: any) => {
          // Serialize per subscription; re-read fresh state inside the lock.
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'sub:' + r.id}, 0))`.execute(trx);
          const sub = rowsOf(await sql`
            SELECT id, tenant_id, status, plan, plan_code, current_period_end, monthly_price_cents, billing_interval, cancel_at
            FROM tenant_subscriptions WHERE id = ${r.id}
          `.execute(trx))[0];
          if (!sub) { res.skipped++; return; }

          const endMs = ms(sub.current_period_end);
          const cs: CycleSubscription = {
            status: String(sub.status),
            currentPeriodEndMs: endMs,
            cancelAtMs: ms(sub.cancel_at),
            monthlyPriceCents: Number(sub.monthly_price_cents ?? 0),
            billingInterval: String(sub.billing_interval ?? 'monthly'),
          };
          const decision = decideRenewal(cs, nowMs);

          if (decision.action === 'skip' || endMs == null) { res.skipped++; return; }

          if (decision.action === 'cancel') {
            await sql`UPDATE tenant_subscriptions SET status='cancelled', cancelled_at=${nowIso}, updated_at=${nowIso} WHERE id=${sub.id} AND status = ${sub.status} AND ${canMoveToSql(TENANT_SUBSCRIPTION, 'cancelled')}`.execute(trx);
            res.cancelled++;
            if (dryRun) throw new DryRunSignal(); // discard the cancel in preview mode
            return;
          }

          // action === 'invoice' — CATCH UP: bill EVERY missed cycle in this one pass. Each cycle starts at the prior
          // period end and runs to the advanced end; loop until the period is current (end > now). Per-period idempotency
          // (guard on period_start) means already-billed cycles are skipped, so a re-run never double-bills. A safety
          // cap stops runaway on corrupt data — residual cycles (if any) are billed on the next pass.
          const year = new Date(nowMs).getUTCFullYear();
          const dueDate = isoDate(nowMs + DUE_DAYS * 86400000);
          const planCode = sub.plan_code ?? sub.plan ?? null;
          // annual price (only for annual intervals) — fetch once; it doesn't change across cycles.
          let annual: number | null = null;
          if (/ann|year/i.test(cs.billingInterval) && sub.plan_code) {
            const plan = rowsOf(await sql`SELECT annual_price_cents FROM subscription_plans WHERE code=${sub.plan_code} LIMIT 1`.execute(trx))[0];
            annual = plan?.annual_price_cents != null ? Number(plan.annual_price_cents) : null;
          }
          const amount = renewalAmountCents(cs, annual);
          // Running invoice sequence for THIS year (all catch-up invoices are dated now). Sequential within the txn, so
          // no cross-row race on the number.
          const seqRows = rowsOf(await sql`SELECT invoice_number FROM billing_invoices WHERE invoice_number LIKE ${'INV-' + year + '-%'}`.execute(trx));
          let seq = seqRows.reduce((m: number, x: any) => Math.max(m, invoiceSeq(String(x.invoice_number), year)), 0);

          let curEnd = endMs;
          let lastStart = endMs;
          let cycles = 0;
          while (curEnd <= nowMs && cycles < MAX_CATCHUP_CYCLES) {
            const startMs = curEnd;
            const nextEnd = advancePeriodEnd(curEnd, cs.billingInterval);
            const startDate = isoDate(startMs);
            // Idempotency per period: never write two invoices for the same cycle.
            const dup = rowsOf(await sql`SELECT id FROM billing_invoices WHERE tenant_id=${sub.tenant_id} AND period_start=${startDate} LIMIT 1`.execute(trx))[0];
            if (!dup && amount > 0) {
              const invNo = nextInvoiceNumber(year, seq); seq += 1;
              await sql`
                INSERT INTO billing_invoices
                  (invoice_number, tenant_id, plan_code, currency, subtotal_cents, total_cents, amount_due_cents, amount_paid_cents, status, invoice_date, due_date, period_start, period_end, last_action)
                VALUES
                  (${invNo}, ${sub.tenant_id}, ${planCode}, 'USD', ${amount}, ${amount}, ${amount}, 0, 'open', ${isoDate(nowMs)}, ${dueDate}, ${startDate}, ${isoDate(nextEnd)}, 'auto_generated')
              `.execute(trx);
              res.invoiced++;
            }
            lastStart = startMs;
            curEnd = nextEnd;
            cycles += 1;
          }

          // Advance the subscription to the now-current period, and convert a trial to active on catch-up.
          const newStatus = decision.convertTrialToActive ? 'active' : sub.status;
          if (newStatus !== sub.status) assertTransition(TENANT_SUBSCRIPTION, sub.status, newStatus);   // Phase 12 (#27): trialing → active
          await sql`
            UPDATE tenant_subscriptions
            SET current_period_start=${isoDate(lastStart)}, current_period_end=${isoDate(curEnd)}, status=${newStatus}, updated_at=${nowIso}
            WHERE id=${sub.id} AND status = ${sub.status}
          `.execute(trx);

          // Preview mode: everything above ran for real inside the txn; discard it so nothing persists.
          if (dryRun) throw new DryRunSignal();
        });
      } catch (e) { if (!(e instanceof DryRunSignal)) res.errors++; }
    }
    return res;
  }
}
