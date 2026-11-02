// messaging-offboard.scheduler.ts — Architecture §149 (Kevin's decision, Oct 28 2026): every few hours, shut down the
// platform-managed texting of salons CANCELLED longer than MESSAGING_OFFBOARD_GRACE_DAYS (default 30): release their Twilio
// number(s) and close their subaccount (PlatformMessagingProvisioner.offboardClosedSalons). A plain unref'd interval, like
// the other schedulers. Off with MESSAGING_OFFBOARD_DISABLED=1; cadence MESSAGING_OFFBOARD_INTERVAL_MS (default 6 h).
// Without the master Twilio credentials the sweep does nothing (honest not_configured).
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { PlatformMessagingProvisioner } from './platform-messaging-provisioner';

@Injectable()
export class MessagingOffboardScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MessagingOffboardScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.MESSAGING_OFFBOARD_INTERVAL_MS || 6 * 60 * 60 * 1000);

  constructor(private readonly provisioner: PlatformMessagingProvisioner) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (process.env.MESSAGING_OFFBOARD_DISABLED === '1') return;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 60_000) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'messaging.offboard_closed_salons', jobClass: 'standard', everyMs: this.intervalMs }, async () => {
        const r = await this.provisioner.offboardClosedSalons(new Date());
        if (r.offboarded || r.failed) this.logger.log(`offboarded ${r.offboarded} cancelled salon(s); ${r.failed} stopped (see offboarding_error)`);
      }).catch((e) => this.logger.warn(`offboardClosedSalons failed: ${e?.message ?? e}`));
    }, this.intervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
