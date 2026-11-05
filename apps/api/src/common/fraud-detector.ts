// fraud-detector.ts — Constitution 12 §172–180 (decision D6): one fraud surface, built on signals that already exist.
//
// NOT a parallel detector. Every input is data the platform already keeps: refunds (who made them, against which
// payment), declined card payments, and the security events earlier phases record. Each rule is small, named and
// EXPLAINED — an owner or Super Admin must be able to read why something was flagged (§176).
//
// FLAG, NEVER BLOCK (§175). A finding records a FRAUD_PATTERN_DETECTED security event and, at HIGH or CRITICAL, opens a
// security incident and a platform alert (which pages, Phase 5). Nothing is refused automatically: a fraud rule that
// locks a real salon out on a false positive does its own damage, and every threshold here is a reasoned default, not
// one tuned on production data yet.
//
// THE RULES (§174 levels)
//   refund_spread  — one employee's CASH refunds across ≥3 different payments in 24 h totalling more than 3× the
//                    per-payment cash approval limit. The gap Phase 11's per-payment rule leaves by design. HIGH.
//   card_testing   — ≥10 declined card payments at one branch in 15 min (HIGH); ≥25 (CRITICAL). Stolen-card checking.
//   sms_wave       — ≥20 SMS_ABUSE_DETECTED events platform-wide in 1 h (HIGH). A pumping campaign, not a stray number.
// Findings are deduplicated per rule + subject per day, so a sustained pattern is one incident, not one per run.
import { runTick, log as rootLog } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { SecurityEvents } from '@aipowersalon/security-center';
import { refundThresholds } from '@aipowersalon/checkout';
import { runsBackgroundJob } from '@aipowersalon/config';

const log = rootLog.withContext({ component: 'fraud-detector' });
export type FraudLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface FraudFinding { rule: 'refund_spread' | 'card_testing' | 'sms_wave'; level: FraudLevel; tenantId: string | null; subject: string; explanation: string }

export const RULES = {
  refundSpread: { windowHours: 24, minPayments: 3, multiple: 3 },
  cardTesting: { windowMinutes: 15, high: 10, critical: 25 },
  smsWave: { windowMinutes: 60, high: 20 },
} as const;
export const RUN_EVERY_MS = 15 * 60_000;

/** Pure: refund rows → findings. */
export function refundSpreadFindings(rows: Array<{ tenantId: string; userId: string; payments: number; totalCents: number }>, cashLimitCents: number): FraudFinding[] {
  const ceiling = cashLimitCents * RULES.refundSpread.multiple;
  return rows.filter((r) => r.payments >= RULES.refundSpread.minPayments && r.totalCents > ceiling).map((r) => ({
    rule: 'refund_spread', level: 'HIGH', tenantId: r.tenantId, subject: `user:${r.userId}`,
    explanation: `One employee made cash refunds against ${r.payments} different payments in ${RULES.refundSpread.windowHours} h, totalling $${(r.totalCents / 100).toFixed(2)} — more than ${RULES.refundSpread.multiple}× the $${(cashLimitCents / 100).toFixed(2)} per-payment approval limit. Each refund stayed under the limit; together they did not.`,
  }));
}
/** Pure: declines per branch → findings. */
export function cardTestingFindings(rows: Array<{ tenantId: string; branchId: string | null; declines: number }>): FraudFinding[] {
  return rows.filter((r) => r.declines >= RULES.cardTesting.high).map((r) => ({
    rule: 'card_testing', level: r.declines >= RULES.cardTesting.critical ? 'CRITICAL' : 'HIGH', tenantId: r.tenantId, subject: `branch:${r.branchId ?? 'none'}`,
    explanation: `${r.declines} declined card payments at one branch within ${RULES.cardTesting.windowMinutes} minutes — the pattern of someone testing stolen cards.`,
  }));
}
/** Pure: the incident reference a finding is deduplicated by (security_incidents.incident_ref is unique PLATFORM-wide —
 *  it is the Super Admin's reference). user:<id> and branch:<id> subjects already name one salon; a card-testing finding
 *  on payments with no branch (`branch:none`) did not — every salon's was the same reference, so the second salon's
 *  incident that day was dropped by ON CONFLICT and its owner never told (Phase 15 C, docs/UNIQUE_INDEX_TENANT_REVIEW.md).
 *  It now carries the salon. Other references are unchanged (an incident already open today keeps its reference). */
export function fraudIncidentRef(f: FraudFinding, day: string): string {
  const subject = f.subject === 'branch:none' && f.tenantId ? `tenant:${f.tenantId}:branch:none` : f.subject;
  return `FRAUD-${f.rule}-${day}-${subject}`.slice(0, 120);
}
/** Pure: platform SMS-abuse count → finding. */
export function smsWaveFindings(count: number): FraudFinding[] {
  return count >= RULES.smsWave.high ? [{ rule: 'sms_wave', level: 'HIGH', tenantId: null, subject: 'platform', explanation: `${count} SMS-abuse refusals or high-cost sends in ${RULES.smsWave.windowMinutes} minutes — a pumping campaign, not a stray number.` }] : [];
}

@Injectable()
export class FraudDetector implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  now: () => Date = () => new Date();
  constructor(@Optional() @Inject(DATABASE) private readonly db: any, @Optional() private readonly events?: SecurityEvents) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'security.fraud_detection', jobClass: 'reconciliation', everyMs: RUN_EVERY_MS }, () => this.run()).catch(() => undefined); }, RUN_EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async detect(): Promise<FraudFinding[]> {
    if (!this.db) return [];
    const now = this.now();
    const since24h = new Date(now.getTime() - RULES.refundSpread.windowHours * 3_600_000);
    const since15m = new Date(now.getTime() - RULES.cardTesting.windowMinutes * 60_000);
    const since1h = new Date(now.getTime() - RULES.smsWave.windowMinutes * 60_000);
    const refunds = (await sql<any>`select r.tenant_id, r.created_by_user_id, count(distinct r.payment_id)::int payments, coalesce(sum(r.amount_cents), 0)::int total
        from payment_refunds r join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
        where r.created_at >= ${since24h} and lower(p.method) = 'cash' and r.created_by_user_id is not null and r.status = 'refunded'   -- a released reservation is DELETED, not marked; 'refunded' is the only live state
        group by r.tenant_id, r.created_by_user_id`.execute(this.db)).rows;
    const declines = (await sql<any>`select tenant_id, branch_id, count(*)::int declines from payments
        where status = 'declined' and created_at >= ${since15m} group by tenant_id, branch_id`.execute(this.db)).rows;
    // Platform-wide ON PURPOSE, and said so: activation-time SMS abuse happens before any salon is known (tenant_id NULL).
    const sms = (await sql<any>`select count(*)::int n from security_events where tenant_id is null and event_type = 'SMS_ABUSE_DETECTED' and occurred_at >= ${since1h}`.execute(this.db)).rows[0]?.n ?? 0;
    return [
      ...refundSpreadFindings(refunds.map((r: any) => ({ tenantId: String(r.tenant_id), userId: String(r.created_by_user_id), payments: r.payments, totalCents: r.total })), refundThresholds().cashCents),
      ...cardTestingFindings(declines.map((r: any) => ({ tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, declines: r.declines }))),
      ...smsWaveFindings(sms),
    ];
  }

  /**
   * The salon's OWNER hears about a pattern in their own salon — through the Owner app's existing alerts, not a new
   * channel. A refund_spread alert names the employee (their own staff) and is OWNER-ONLY (migration 457): managers can
   * read owner alerts and a manager can be the employee flagged. card_testing is about outsiders, so managers see it
   * too. Platform-wide findings (sms_wave) have no salon to tell. Written once per finding (the incident dedup above).
   */
  private async notifyOwner(f: FraudFinding, ref: string): Promise<void> {
    if (!f.tenantId || !this.db) return;
    let title = 'Possible fraud', body = f.explanation, branchId: string | null = null, audience = 'all';
    if (f.rule === 'refund_spread') {
      const userId = f.subject.replace(/^user:/, '');
      const who = (await sql<any>`select full_name from users where id = ${userId} and tenant_id = ${f.tenantId} limit 1`.execute(this.db).catch(() => ({ rows: [] }))).rows[0]?.full_name;
      title = 'Review: cash refunds spread across payments';
      body = `${who ? `${who} made` : 'One employee made'} ${f.explanation.replace(/^One employee made /, '')} This may be legitimate — please review the refunds in Reports. Only owners can see this alert.`;
      audience = 'owner';
    } else if (f.rule === 'card_testing') {
      title = 'Possible card testing at your salon';
      branchId = f.subject.startsWith('branch:') && f.subject !== 'branch:none' ? f.subject.slice(7) : null;
      body = `${f.explanation} If this was not you, check the card terminal and contact your payment processor.`;
    } else return;
    try {
      await sql`insert into owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
          values (${f.tenantId}, ${branchId}, 'fraud', ${f.level === 'CRITICAL' ? 'critical' : 'high'}, 'new', ${title}, ${body},
                  ${JSON.stringify({ rule: f.rule, incidentRef: ref })}::jsonb, ${audience})`.execute(this.db);
    } catch (e) { log.error('fraud.owner_notify_failed', { rule: f.rule, error: (e as Error).message }); }
  }

  /** Detect and report. Dedup per rule + subject + day: a sustained pattern is one incident, not one per run. */
  async run(): Promise<FraudFinding[]> {
    const findings = await this.detect();
    const day = this.now().toISOString().slice(0, 10).replace(/-/g, '');
    for (const f of findings) {
      const ref = fraudIncidentRef(f, day);
      try {
        const fresh = (await sql`insert into security_incidents (incident_ref, title, description, category, severity, status, detection_source, tenant_id, detected_at)
            values (${ref}, ${`Fraud pattern: ${f.rule.replace('_', ' ')}`}, ${f.explanation}, 'fraud', ${f.level.toLowerCase()}, 'detected', 'fraud_detector', ${f.tenantId}, ${this.now()})
            on conflict (incident_ref) do nothing returning incident_ref`.execute(this.db)).rows.length > 0;
        if (!fresh) continue;                                        // already reported today
        void this.events?.record({ type: 'FRAUD_PATTERN_DETECTED', severity: f.level, tenantId: f.tenantId, actorType: 'service', resourceType: f.rule, resourceId: f.subject, reason: f.explanation });
        await this.notifyOwner(f, ref);
        if (f.level === 'HIGH' || f.level === 'CRITICAL') {
          await sql`insert into alerts (id, tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
              values (gen_random_uuid(), null, 'Platform', ${`Fraud pattern: ${f.rule.replace('_', ' ')}`}, ${f.explanation}, 'security', ${f.level === 'CRITICAL' ? 'critical' : 'high'}, 'unread', 'security_signal', ${ref}, ${ref})
              on conflict (dedupe_key) do nothing`.execute(this.db);
        }
      } catch (e) { log.error('fraud.report_failed', { rule: f.rule, error: (e as Error).message }); }
    }
    return findings;
  }
}
