// integrity-checks.ts — Constitution 11 §121, §205–209: records whose salon disagrees with the record they point to.
//
// §121: "if an internal worker/event says tenant A but the resource belongs to tenant B, treat it as a CRITICAL
// data-integrity/security signal." Nothing can see that at request time — the damage is already in the data. §207
// gives the method: scheduled, safe checks of high-value invariants.
//
// THE LIST IS CURATED, NOT DERIVED. The schema declares 86 foreign keys where both sides carry tenant_id, but some
// relationships may cross salons BY DESIGN (cross-salon technician transfers, marketplace deals, platform users
// referenced from salon rows), and a critical check that pages at 3 a.m. on legitimate data does real harm. So these
// are the relationships where a crossed salon id is unambiguous damage — a ticket charging a customer of another
// salon, a payment against another salon's ticket — each verified against the real schema by a test. Widening the
// list is a reviewed change, one relationship at a time.
//
// SAFE (§207, §209). Read-only; each check is `count` over a bounded subquery with a statement timeout, so one slow
// table cannot stall the rest. NULL on either side is not a mismatch (optional links, platform rows). It DETECTS and
// REPORTS — it never repairs (§209: no automatic repair of sensitive data without a proven deterministic fix).
import { registry, log as rootLog, runTick } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import type { Evaluation } from './health-core';
import { runsBackgroundJob } from '@aipowersalon/config';

const log = rootLog.withContext({ component: 'integrity-checks' });
export const CHECK_EVERY_MS = 6 * 60 * 60_000;       // four times a day: cheap enough, soon enough
export const SAMPLE_CAP = 1_000;                      // count at most this many offending rows per check
export const STATEMENT_TIMEOUT_MS = 20_000;
export const FIRST_RUN_AFTER_MS = 2 * 60_000;

export interface Invariant { id: string; child: string; column: string; parent: string; why: string }

export const INVARIANTS: readonly Invariant[] = [
  { id: 'appointment_customer', child: 'pos_tech_appointments', column: 'customer_id', parent: 'customers', why: 'an appointment for another salon\'s customer' },
  { id: 'appointment_technician', child: 'pos_tech_appointments', column: 'technician_id', parent: 'technicians', why: 'an appointment with another salon\'s technician' },
  { id: 'appointment_branch', child: 'pos_tech_appointments', column: 'branch_id', parent: 'branches', why: 'an appointment at another salon\'s branch' },
  { id: 'queue_customer', child: 'pos_queue_items', column: 'customer_id', parent: 'customers', why: 'a queue entry for another salon\'s customer' },
  { id: 'queue_branch', child: 'pos_queue_items', column: 'branch_id', parent: 'branches', why: 'a queue entry in another salon\'s branch' },
  { id: 'queue_technician', child: 'pos_queue_items', column: 'assigned_technician_id', parent: 'technicians', why: 'a queue entry assigned to another salon\'s technician' },
  { id: 'queue_ticket', child: 'pos_queue_items', column: 'ticket_id', parent: 'tickets', why: 'a queue entry linked to another salon\'s ticket' },
  { id: 'ticket_customer', child: 'tickets', column: 'customer_id', parent: 'customers', why: 'a ticket charging another salon\'s customer' },
  { id: 'ticket_branch', child: 'tickets', column: 'branch_id', parent: 'branches', why: 'a ticket at another salon\'s branch' },
  { id: 'ticket_technician', child: 'tickets', column: 'primary_technician_id', parent: 'technicians', why: 'a ticket paying another salon\'s technician' },
  { id: 'payment_ticket', child: 'payments', column: 'ticket_id', parent: 'tickets', why: 'money taken against another salon\'s ticket' },
  { id: 'refund_payment', child: 'payment_refunds', column: 'payment_id', parent: 'payments', why: 'a refund of another salon\'s payment' },
  { id: 'intent_ticket', child: 'payment_intents', column: 'ticket_id', parent: 'tickets', why: 'a payment intent for another salon\'s ticket' },
  { id: 'intent_customer', child: 'payment_intents', column: 'customer_id', parent: 'customers', why: 'a payment intent for another salon\'s customer' },
  { id: 'technician_branch', child: 'technicians', column: 'branch_id', parent: 'branches', why: 'a technician homed in another salon\'s branch' },
  { id: 'customer_branch', child: 'customers', column: 'branch_id', parent: 'branches', why: 'a customer homed in another salon\'s branch' },
  { id: 'gift_card_customer', child: 'gift_cards', column: 'customer_id', parent: 'customers', why: 'a gift card owned by another salon\'s customer' },
  { id: 'membership_customer', child: 'customer_memberships', column: 'customer_id', parent: 'customers', why: 'a membership held by another salon\'s customer' },
  // BUILD_PLAN Phase 10 (Constitution 1 §29–32, migration 539): five more links, prevented by trigger AND detected here.
  // gift_card_transactions is checked against the CARD only — a shared-program redemption books the ledger row at the
  // issuing salon while its ticket belongs to the redeeming one (by design, Constitution gift-card §15–16).
  { id: 'ticket_line_ticket', child: 'ticket_service_lines', column: 'ticket_id', parent: 'tickets', why: 'a service line on another salon\'s ticket' },
  { id: 'gift_card_txn_card', child: 'gift_card_transactions', column: 'gift_card_id', parent: 'gift_cards', why: 'a gift-card ledger row booked against another salon\'s card' },
  { id: 'loyalty_ledger_customer', child: 'loyalty_ledger', column: 'customer_id', parent: 'customers', why: 'loyalty points moved for another salon\'s customer' },
  { id: 'loyalty_profile_customer', child: 'customer_loyalty_profiles', column: 'customer_id', parent: 'customers', why: 'a loyalty balance held for another salon\'s customer' },
  { id: 'deal_redemption_deal', child: 'deal_redemptions', column: 'deal_id', parent: 'deals', why: 'a redemption of another salon\'s deal' },
  // Fair Turn Engine (Oct 12 2026, migrations 601–602): turn rules, turn state and the append-only turn log never name
  // another salon's service, technician, branch or queue entry.
  { id: 'turn_unit_rule_service', child: 'turn_unit_rules', column: 'service_id', parent: 'services', why: 'a turn rule on another salon\'s service' },
  { id: 'turn_state_technician', child: 'technician_turn_state', column: 'technician_id', parent: 'technicians', why: 'a turn position for another salon\'s technician' },
  { id: 'turn_state_branch', child: 'technician_turn_state', column: 'branch_id', parent: 'branches', why: 'a turn position in another salon\'s branch' },
  { id: 'turn_event_technician', child: 'technician_turn_events', column: 'technician_id', parent: 'technicians', why: 'a turn event for another salon\'s technician' },
  { id: 'turn_event_branch', child: 'technician_turn_events', column: 'branch_id', parent: 'branches', why: 'a turn event in another salon\'s branch' },
  { id: 'turn_event_queue_item', child: 'technician_turn_events', column: 'queue_item_id', parent: 'pos_queue_items', why: 'a turn event on another salon\'s queue entry' },
  // Oct 13 2026 (wave 3, migrations 638 / 646 / 660): branch merchant accounts, technician employment history, Tap to Pay devices.
  { id: 'merchant_account_branch', child: 'payment_merchant_accounts', column: 'branch_id', parent: 'branches', why: 'a merchant account mapped to another salon\'s branch' },
  { id: 'tee_technician', child: 'technician_employment_events', column: 'technician_id', parent: 'technicians', why: 'an employment-history row for another salon\'s technician' },
  { id: 'tee_branch', child: 'technician_employment_events', column: 'branch_id', parent: 'branches', why: 'an employment-history row at another salon\'s branch' },
  { id: 'mobile_pay_device_branch', child: 'mobile_pay_devices', column: 'branch_id', parent: 'branches', why: 'a payment phone registered to another salon\'s branch' },  // Nov 5 2026 (migration 674, platform POS announcements): the triggers existed; the detection side did not.
  { id: 'platform_notice_targets__branch_id', child: 'platform_notice_targets', column: 'branch_id', parent: 'branches', why: 'an announcement targeted at another salon\'s branch' },
  { id: 'platform_notice_receipts__branch_id', child: 'platform_notice_receipts', column: 'branch_id', parent: 'branches', why: 'an announcement receipt recorded against another salon\'s branch' },
];

export const integrityViolations = registry.gauge('aipowersalon_integrity_violations', 'Rows violating a tenant-consistency invariant (capped)', ['invariant']);
export interface CheckResult { id: string; violations: number; capped: boolean; error: string | null; sampleIds: string[] }

let lastRun: { at: number; results: CheckResult[] } | null = null;
export function lastIntegrityRun() { return lastRun; }
export function resetIntegrityRun() { lastRun = null; }

/** §208: any cross-tenant relationship anomaly is CRITICAL. A check that could not run is UNKNOWN for that check. */
export function evaluateIntegrity(run: { at: number; results: CheckResult[] } | null, now: number): Evaluation {
  if (!run) return { status: 'UNKNOWN', reason: 'not_run_yet', summary: {} };
  if (now - run.at > 3 * CHECK_EVERY_MS) return { status: 'UNKNOWN', reason: 'stale', summary: {} };
  const bad = run.results.filter((r) => r.violations > 0);
  const failed = run.results.filter((r) => r.error);
  const summary = { checks: run.results.length, violating: bad.length, failedToRun: failed.length, rows: bad.reduce((a, r) => a + r.violations, 0) };
  if (bad.length) return { status: 'OUTAGE', reason: `cross_tenant:${bad.map((b) => b.id).sort().join(',')}`, summary };
  if (failed.length) return { status: 'DEGRADED', reason: `check_failed:${failed.map((f) => f.id).sort().join(',')}`, summary };
  return { status: 'HEALTHY', reason: 'ok', summary };
}

@Injectable()
export class IntegrityChecks implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  private first: NodeJS.Timeout | null = null;
  onModuleInit(): void {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    // First run shortly after boot, not six hours later: a fresh deployment would otherwise be blind (UNKNOWN) for a
    // quarter of a day — and UNKNOWN would resolve an integrity alert that is still true. Both calls are written out
    // inline: the scheduler coverage guard (rightly) cannot see through `setInterval(tick, …)`, which is exactly how a
    // bare, uninstrumented tick would hide.
    this.first = setTimeout(() => { void runTick({ jobType: 'integrity.tenant_consistency', jobClass: 'reconciliation', everyMs: CHECK_EVERY_MS }, () => this.runAll()).catch(() => undefined); }, FIRST_RUN_AFTER_MS);
    this.timer = setInterval(() => { void runTick({ jobType: 'integrity.tenant_consistency', jobClass: 'reconciliation', everyMs: CHECK_EVERY_MS }, () => this.runAll()).catch(() => undefined); }, CHECK_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.first) clearTimeout(this.first); }

  async check(inv: Invariant): Promise<CheckResult> {
    try {
      const rows = await this.db.transaction().execute(async (trx: any) => {
        await sql`set local statement_timeout = ${sql.raw(String(STATEMENT_TIMEOUT_MS))}`.execute(trx);
        return (await sql<{ id: string }>`select c.id::text as id from ${sql.table(inv.child)} c
            join ${sql.table(inv.parent)} p on p.id = c.${sql.ref(inv.column)}
            where c.tenant_id is not null and p.tenant_id is not null and c.tenant_id <> p.tenant_id
            limit ${SAMPLE_CAP}`.execute(trx)).rows;
      });
      return { id: inv.id, violations: rows.length, capped: rows.length >= SAMPLE_CAP, error: null, sampleIds: rows.slice(0, 5).map((r: any) => r.id) };
    } catch (e) {
      return { id: inv.id, violations: 0, capped: false, error: String((e as Error).message).slice(0, 200), sampleIds: [] };
    }
  }

  async runAll(now = Date.now()): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const inv of INVARIANTS) {
      const r = await this.check(inv);
      results.push(r);
      integrityViolations.set(r.violations, { invariant: inv.id });
      if (r.violations > 0) log.error('integrity.cross_tenant_violation', { invariant: inv.id, rows: r.violations, capped: r.capped, sampleIds: r.sampleIds, why: inv.why });
      if (r.error) log.warn('integrity.check_failed', { invariant: inv.id, error: r.error });
    }
    lastRun = { at: now, results };
    return results;
  }
}
