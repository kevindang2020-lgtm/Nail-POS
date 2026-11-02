// certification-expiry.scheduler.ts — reminds technicians 30 / 14 / 7 days before a certification expires and flips
// past-date rows to EXPIRED (workforce audit P2 #28; merged Oct 12 2026 from the other chat).
//
// Platform scheduler convention: in-process setInterval, unref'd, non-overlapping, gated by runsBackgroundJob('standard')
// (Constitution 13 Phase 8) AND CERT_EXPIRY_REMINDER_ENABLED (off by default), each tick wrapped in runTick (job
// telemetry) and runAsSingleOwner (one instance per tick).
//
// Delivery: the in-app technician notification row (technician_notifications), written in the SAME transaction as the
// (certification, window) bookkeeping row — so a reminder is recorded exactly when it was delivered, and a second
// instance / a retry can never send it twice. (Theirs also queued an email through a durable communication queue our
// tree does not have — not ported; the in-app row is the delivery, see the merge ledger.)
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runAsSingleOwner } from '@aipowersalon/database';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { TechnicianCertificationsService } from './technician-certifications';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // four times a day is plenty for a 7-day-granularity reminder
export const CERT_REMINDER_DAYS = [30, 14, 7] as const;

export function certExpiryReminderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CERT_EXPIRY_REMINDER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
export function reminderBody(name: string, expiresAt: string, daysBefore: number): string {
  return `Your certification "${name}" expires on ${expiresAt} (in ${daysBefore} days or less). Please renew it and update the document in your Technician App so you stay eligible for the services that require it.`;
}

/** Pure-ish core, testable without Nest: sweep → (bookkeeping row + in-app notification, one transaction each). */
export async function runCertificationExpirySweep(deps: { certs: Pick<TechnicianCertificationsService, 'sweep'>; db: Kysely<any>; days?: number[] }): Promise<{ expired: number; reminded: number }> {
  const { expired, due } = await deps.certs.sweep(deps.days ?? [...CERT_REMINDER_DAYS]);
  let reminded = 0;
  for (const d of due) {
    const sent = await deps.db.transaction().execute(async (trx) => {
      const claimed = await trx.insertInto('technician_certification_reminders').values({ certification_id: d.certificationId, days_before: d.daysBefore })
        .onConflict((oc: any) => oc.columns(['certification_id', 'days_before']).doNothing()).returning('certification_id').executeTakeFirst();
      if (!claimed) return false;                               // another tick already delivered this window
      if (!d.technicianId || !d.tenantId) return false;          // a portable-only row with no roster to notify: recorded, nothing to send
      await trx.insertInto('technician_notifications').values({ tenant_id: d.tenantId, technician_id: d.technicianId, type: 'certification_expiring', title: `Certification expiring in ${d.daysBefore} days`, body: reminderBody(d.name, d.expiresAt, d.daysBefore), reference: d.certificationId }).execute();
      return true;
    });
    if (sent) reminded++;
  }
  return { expired, reminded };
}

@Injectable()
export class CertificationExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CertificationExpiry');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly certs: TechnicianCertificationsService, private readonly db: Kysely<any> | null) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8 (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!certExpiryReminderEnabled() || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'technician.certification.expiry', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Certification-expiry scheduler armed (every 6h).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops can trigger it and tests can run it without waiting. */
  async tick(): Promise<{ expired: number; reminded: number } | null> {
    if (this.running || !this.db) return null;
    this.running = true;
    try {
      const r = await runAsSingleOwner(this.db, 'certification-expiry', () => runCertificationExpirySweep({ certs: this.certs, db: this.db!, days: [...CERT_REMINDER_DAYS] }));
      if (!r.ran) return null;
      if (r.result.expired || r.result.reminded) this.log.log(`expired ${r.result.expired}, reminded ${r.result.reminded}`);
      return r.result;
    } finally { this.running = false; }
  }
}
