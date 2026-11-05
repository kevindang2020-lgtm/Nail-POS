// sms-packages.module.ts — P1 wiring. The service takes the shared Kysely db via the existing DATABASE token
// pattern used across SA modules.
import { Module } from '@nestjs/common';
import { SmsPackagesController } from './sms-packages.controller';
import { SmsPackagesService } from './sms-packages.service';
import { SmsEntitlementService, smsVerificationSource, SMS_VERIFICATION_KIND } from './sms-entitlement.service';
import { ENTITLEMENT_SERVICE, type EntitlementService } from '@aipowersalon/permissions';
import { SmsTenantPlanService } from './sms-tenant-plan.service';
import { SmsTenantPlanController } from './sms-tenant-plan.controller';
import { TenantSmsPlanController } from './tenant-sms-plan.controller';
import { SmsReconciliationService, SmsReconciliationScheduler } from './sms-reconciliation.service';
import { SmsBillingService } from './sms-billing.service';
import { SmsPlatformControlsService } from './sms-platform-controls.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SmsPackagesController, SmsTenantPlanController, TenantSmsPlanController],
  providers: [
    { provide: SmsPackagesService, inject: [DATABASE], useFactory: (db: AppDatabase) => new SmsPackagesService(db as any) },
    { provide: SmsPlatformControlsService, inject: [DATABASE], useFactory: (db: AppDatabase) => new SmsPlatformControlsService(db as any) },
    // BUILD_PLAN Phase 12 (#13): the same instance is registered as the shared EntitlementService's 'sms_verification' source
    { provide: SmsEntitlementService, inject: [DATABASE, SmsPlatformControlsService, { token: ENTITLEMENT_SERVICE, optional: true }], useFactory: (db: AppDatabase, c: SmsPlatformControlsService, gate?: EntitlementService) => { const svc = new SmsEntitlementService(db as any, c); if (gate && !gate.has(SMS_VERIFICATION_KIND)) gate.register(smsVerificationSource(svc)); return svc; } },
    { provide: SmsTenantPlanService, inject: [DATABASE, SmsEntitlementService, SmsPlatformControlsService], useFactory: (db: AppDatabase, ent: SmsEntitlementService, c: SmsPlatformControlsService) => new SmsTenantPlanService(db as any, ent, c) },
    { provide: SmsReconciliationService, inject: [DATABASE], useFactory: (db: AppDatabase) => new SmsReconciliationService(db as any) },
    // Factory, not a bare class: the scheduler's 2nd ctor param is a defaulted `() => Date` (reflected type
    // Function), which Nest cannot resolve — a bare-class registration crashes the real boot. Tests inject the
    // clock directly; production uses the default.
    { provide: SmsReconciliationScheduler, inject: [SmsReconciliationService], useFactory: (svc: SmsReconciliationService) => new SmsReconciliationScheduler(svc) },
    { provide: SmsBillingService, inject: [DATABASE], useFactory: (db: AppDatabase) => new SmsBillingService(db as any) },
  ],
  exports: [SmsPackagesService, SmsEntitlementService, SmsTenantPlanService, SmsReconciliationService, SmsBillingService, SmsPlatformControlsService],
})
export class SmsPackagesModule {}
