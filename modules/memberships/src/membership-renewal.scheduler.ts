// membership-renewal.scheduler.ts — runs membership renewal REMINDERS and due RENEWALS in-process (w4 sweep SW-17).
//
// Until Oct 13 2026 the only way to run them was POST /internal/membership-billing/run-renewals / run-reminders — an
// endpoint for an external cron that nothing ever called, so an auto-renewing membership never renewed. This scheduler
// makes the SAME two service calls the endpoint makes (the endpoint stays, for ops), once an hour, single-owner across the
// fleet (runTick → the scheduler_runs lease), in a process that runs 'critical' jobs.
//
// MEMBERSHIP_RENEWALS_CRON_ENABLED=1 arms it (off by default — the hardware-payment pattern — so dev / CI never charge).
// Charging still needs MEMBERSHIP_AUTOBILL_ENABLED (the charge port); without it the sweep answers not_configured and
// charges nothing. Renewals are idempotent per (membership, due date) — renewalIdempotencyKey — so an extra tick is safe.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { MembershipBillingService } from './membership-billing.service';
import { MembershipCommsService } from './membership-comms.service';

export const MEMBERSHIP_RENEWALS_EVERY_MS = 60 * 60_000;
export function membershipRenewalsCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.MEMBERSHIP_RENEWALS_CRON_ENABLED ?? '').trim().toLowerCase());
}

@Injectable()
export class MembershipRenewalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MembershipRenewals');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly billing: MembershipBillingService, private readonly comms: MembershipCommsService) {}

  get armed(): boolean { return this.timer !== null; }

  onModuleInit(): void {
    if (!runsBackgroundJob('critical') || !membershipRenewalsCronEnabled()) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'memberships.renewals', jobClass: 'critical', everyMs: MEMBERSHIP_RENEWALS_EVERY_MS }, () => this.tick()).catch(() => undefined);
    }, MEMBERSHIP_RENEWALS_EVERY_MS);
    this.timer.unref?.();
    this.log.log('Membership renewal scheduler armed (reminders + due renewals, hourly, single owner).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One pass: the reminders for the next 7 days, then up to 100 due renewals — exactly what the internal endpoint runs. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.comms.runRenewalRemindersDue(now, 7, 500);
      const b = await this.billing.runDueRenewals(now, 100);
      const expired = await this.billing.expireAgedCredits(now).catch((e) => { this.log.warn(`membership credit expiry failed (renewals still ran): ${(e as Error)?.message ?? e}`); return 0; });   // the plans' credit expiry (days)
      if (expired) this.log.log(`membership credits expired by age: ${expired}`);
      if ((b as any)?.due) this.log.log(`membership renewals: ${JSON.stringify({ due: b.due, succeeded: b.succeeded, failed: b.failed, notConfigured: b.notConfigured, reminders: r })}`);
    } finally { this.running = false; }
  }
}
