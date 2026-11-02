// technician-clock-pin.module.ts — Kysely-backed when Postgres present, else in-memory.
// Exposes only the service (PIN set/verify/identify). No controller here: the kiosk-facing surface lives in the
// Go Check-In module (device-token authenticated), and manager PIN-reset will live with the management routes.
import { Module } from '@nestjs/common';
import { pinLookupKeyFromEnv } from './clock-pin-lookup';
import { TechnicianClockPinService } from './technician-clock-pin.service';
import { InMemoryClockPinRepository, type ClockPinRepository } from './technician-clock-pin.repository';
import { KyselyClockPinRepository } from './technician-clock-pin.kysely.repository';
import { TechnicianClockManagementService, type ClockManagementRepository } from './technician-clock-management.service';
import { InMemoryClockManagementRepository } from './technician-clock-management.repository';
import { KyselyClockManagementRepository } from './technician-clock-management.kysely.repository';
import { TechnicianClockManagementController } from './technician-clock-management.controller';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { InMemoryKioskPinLimiter } from './kiosk-pin-limiter';
import { WorkforceStatusService } from '../workforce-status/workforce-status.service';

@Module({
  controllers: [TechnicianClockManagementController],
  providers: [
    { provide: 'ClockPinRepository', useFactory: (db: AppDatabase): ClockPinRepository => (db ? new KyselyClockPinRepository(db) : new InMemoryClockPinRepository()), inject: [DATABASE] },
    // Kiosk identify lockout (Technician Profile merge): failures per (tenant, kiosk) — the per-technician DB lockout alone
    // never counted an enumeration of the whole 4-digit space. Per-instance window; never silently absent.
    { provide: TechnicianClockPinService, useFactory: (repo: ClockPinRepository) => new TechnicianClockPinService(repo, new InMemoryKioskPinLimiter(), pinLookupKeyFromEnv()), inject: ['ClockPinRepository'] },
    { provide: 'ClockManagementRepository', useFactory: (db: AppDatabase): ClockManagementRepository => (db ? new KyselyClockManagementRepository(db) : new InMemoryClockManagementRepository()), inject: [DATABASE] },
    { provide: TechnicianClockManagementService, useFactory: (pins: TechnicianClockPinService, repo: ClockManagementRepository, wf?: WorkforceStatusService) => new TechnicianClockManagementService(pins, repo, wf ?? null), inject: [TechnicianClockPinService, 'ClockManagementRepository', { token: WorkforceStatusService, optional: true }] },
  ],
  exports: [TechnicianClockPinService, TechnicianClockManagementService],
})
export class TechnicianClockPinModule {}
