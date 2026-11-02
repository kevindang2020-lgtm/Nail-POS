// sms-reconciliation.service.ts — §58 nightly SMS accounting + the house-pattern scheduler (sms-packages P6).
//
// What it checks (internal truth, every open cycle):
//   · counter_ledger_mismatch  — the cycle's counters vs a fresh LEDGER recount. The ledger is the auditable
//     source (§20); a disagreement is FILED with both numbers, and NOTHING is auto-corrected (§58: never modify
//     invoices silently — a human resolves with the evidence in front of them).
//   · unbilled_usage_no_package — real verification traffic ledgered billable:false 'no package' this month for a
//     tenant with no subscription: Super Admin should assign a package (§32 "package missing").
//   · hard_limit_reached — a tenant stopped at their allowance right now (§32 limit alert).
//
// What it deliberately does NOT do here: compare against Twilio's own message records. That needs live provider
// credentials (an owner-side key). The seam is the `provider` argument — when creds exist, a TwilioUsageSource
// implements it and the same run() gains the external pass. Until then the run summary says so honestly instead
// of pretending the check ran.
//
// §59 dedupe is the DATABASE's job (partial unique in migration 429): the upsert updates the open finding's
// details night after night; it cannot mint duplicates.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { runsBackgroundJob } from '@aipowersalon/config';
import { canMoveToSql } from '@aipowersalon/database';
import { SMS_RECONCILIATION_FINDING } from '../communications-lifecycles';

export interface ProviderUsageSource {
  /** Future Twilio pass: message counts per tenant for a window. Absent in-sandbox. */
  countMessages(tenantId: string, fromIso: string, toIso: string): Promise<number>;
}

@Injectable()
export class SmsReconciliationService {
  constructor(private readonly db?: Kysely<any>, private readonly provider?: ProviderUsageSource) { }
  private need(): Kysely<any> { if (!this.db) throw new Error('sms reconciliation: no db'); return this.db; }

  /** One full pass. Returns an honest summary; findings land in sms_reconciliation_findings (§59 dedupe). */
  async runDaily(runDate = new Date()): Promise<{ cyclesChecked: number; findingsUpserted: number; providerComparison: 'ran' | 'unavailable' }> {
    const day = runDate.toISOString().slice(0, 10);
    let findings = 0;

    const cycles: any = await sql`
      select c.*, s.custom_allowance
      from tenant_sms_billing_cycles c
      left join tenant_sms_subscriptions s on s.tenant_id = c.tenant_id and s.status = 'active'
      where c.status = 'open'`.execute(this.need());

    for (const c of cycles.rows ?? []) {
      const led: any = await sql`
        select
          count(*) filter (where billable = true and status <> 'FAILED') as billable_n,
          count(*) filter (where status = 'FAILED') as failed_n
        from sms_usage_records where billing_cycle_id = ${c.id}`.execute(this.need());
      const billable = Number(led.rows[0].billable_n);
      const failed = Number(led.rows[0].failed_n);
      const counters = Number(c.used_included) + Number(c.overage_count);
      if (billable !== counters || failed !== Number(c.failed_count)) {
        await this.upsert(day, String(c.tenant_id), String(c.id), 'counter_ledger_mismatch', {
          ledgerBillable: billable, counterTotal: counters,
          ledgerFailed: failed, counterFailed: Number(c.failed_count),
          usedIncluded: Number(c.used_included), overageCount: Number(c.overage_count),
        });
        findings++;
      }
      const allowance = Number(c.included_count) + Number(c.credit_allowance) + Number(c.custom_allowance ?? 0);
      if (c.hard_limit_enabled && Number(c.used_included) >= allowance) {
        await this.upsert(day, String(c.tenant_id), String(c.id), 'hard_limit_reached', {
          allowance, usedIncluded: Number(c.used_included), cycleEnd: c.cycle_end,
        });
        findings++;
      }
    }

    // Traffic with no package this calendar month (billable:false, cycle-less rows) for tenants without a sub.
    const monthStart = `${day.slice(0, 7)}-01`;
    const orphans: any = await sql`
      select u.tenant_id, count(*) as n
      from sms_usage_records u
      left join tenant_sms_subscriptions s on s.tenant_id = u.tenant_id and s.status = 'active'
      where u.billing_cycle_id is null and u.billable = false and u.status <> 'FAILED'
        and u.requested_at >= ${monthStart}::date and s.id is null
      group by u.tenant_id`.execute(this.need());
    for (const o of orphans.rows ?? []) {
      await this.upsert(day, String(o.tenant_id), null, 'unbilled_usage_no_package', { unbilledThisMonth: Number(o.n) });
      findings++;
    }

    return { cyclesChecked: (cycles.rows ?? []).length, findingsUpserted: findings, providerComparison: this.provider ? 'ran' : 'unavailable' };
  }

  async listOpenFindings() {
    const r: any = await sql`
      select f.*, t.display_name as tenant_name
      from sms_reconciliation_findings f join tenants t on t.id = f.tenant_id
      where f.status = 'open' order by f.updated_at desc limit 200`.execute(this.need());
    return {
      findings: (r.rows ?? []).map((f: any) => ({
        id: String(f.id), runDate: f.run_date, tenantId: String(f.tenant_id), tenantName: String(f.tenant_name),
        cycleId: f.cycle_id ? String(f.cycle_id) : null, findingType: String(f.finding_type),
        details: f.details ?? {}, updatedAt: f.updated_at,
      }))
    };
  }

  async resolveFinding(actorUserId: string | null, findingId: string, disposition: 'resolved' | 'dismissed') {
    const r: any = await sql`update sms_reconciliation_findings
      set status = ${disposition}, resolved_at = now(), resolved_by = ${actorUserId}, updated_at = now()
      where id = ${findingId} and status = 'open' and ${canMoveToSql(SMS_RECONCILIATION_FINDING, disposition)}`.execute(this.need());
    return { ok: Number(r.numAffectedRows ?? 0) > 0 };
  }

  private async upsert(day: string, tenantId: string, cycleId: string | null, type: string, details: Record<string, unknown>) {
    await sql`insert into sms_reconciliation_findings (run_date, tenant_id, cycle_id, finding_type, details)
      values (${day}::date, ${tenantId}, ${cycleId}, ${type}, ${JSON.stringify(details)}::jsonb)
      on conflict (tenant_id, finding_type, cycle_id) where status = 'open'
      do update set details = excluded.details, run_date = excluded.run_date, updated_at = now()`.execute(this.need());
  }
}

/** House-pattern scheduler (mirrors CustomerSyncScheduler): env-gated, 5-minute tick, fires once per day at/after
 *  03:30 local, injectable clock so tests drive the SAME tick() the server runs. */
export function smsReconWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SMS_RECON_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const TICK_MS = 5 * 60 * 1000;
const FIRE_HOUR = 3, FIRE_MINUTE = 30;

@Injectable()
export class SmsReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SmsReconciliationScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastRunDay: string | null = null;

  constructor(private readonly svc: SmsReconciliationService, @Optional() private readonly now: () => Date = () => new Date()) { }

  onModuleInit() {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!smsReconWorkerEnabled()) { this.log.log('SMS reconciliation worker disabled (SMS_RECON_WORKER_ENABLED unset).'); return; }
    this.timer = setInterval(() => { void runTick({ jobType: 'sms.reconciliation', jobClass: 'reconciliation', everyMs: TICK_MS }, () => this.tick()).catch(() => undefined); }, TICK_MS);
    this.log.log('SMS reconciliation worker armed (daily at 03:30).');
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Exported for tests: the exact production decision + run path. */
  async tick(nowOverride?: Date): Promise<'ran' | 'skipped'> {
    const now = nowOverride ?? this.now();
    const day = now.toISOString().slice(0, 10);
    const due = now.getHours() > FIRE_HOUR || (now.getHours() === FIRE_HOUR && now.getMinutes() >= FIRE_MINUTE);
    if (!due || this.lastRunDay === day || this.running) return 'skipped';
    this.running = true;
    try {
      const out = await this.svc.runDaily(now);
      this.lastRunDay = day;
      this.log.log(`SMS reconciliation: ${out.cyclesChecked} cycles, ${out.findingsUpserted} findings, provider comparison ${out.providerComparison}.`);
      return 'ran';
    } catch (e) {
      this.log.error(`SMS reconciliation failed: ${(e as Error)?.message}`);
      return 'skipped';
    } finally { this.running = false; }
  }
}
