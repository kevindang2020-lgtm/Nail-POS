// price-schedule.job.ts — D4 Service Pricing gaps (Nov 5 2026): applies scheduled (future-effective) price / duration changes
// when they come due. Every minute, one process at a time (runAsSingleOwner), each schedule applied once (a conditional
// scheduled → applied move). SERVICE_PRICE_SCHEDULE_JOB=off stops it; a read of the service also applies its due schedule.
import { Injectable, Inject, Optional, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { runAsSingleOwner, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { CATALOG_SCREENS } from './catalog-screens.controller';
import type { CatalogScreensRepository } from './catalog-screens.repository';

@Injectable()
export class PriceScheduleJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly log = new Logger('PriceScheduleJob');
  constructor(@Optional() @Inject(CATALOG_SCREENS) private readonly repo: CatalogScreensRepository | null, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}
  onModuleInit() {
    if (!runsBackgroundJob('standard')) return;
    if (!this.repo || !this.db || process.env.SERVICE_PRICE_SCHEDULE_JOB === 'off' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void runAsSingleOwner(this.db as Kysely<any>, 'catalog.price_schedule', () => (this.repo as CatalogScreensRepository).applyDueSchedules())
        .catch((e) => this.log.warn(`scheduled price sweep failed: ${(e as Error)?.message}`));
    }, 60_000);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
