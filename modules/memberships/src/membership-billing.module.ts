// membership-billing.module.ts — wires the billing engine. Repository is Kysely-backed when Postgres is present, else
// in-memory. The charge port is intentionally NOT bound to a live processor here: the service defaults to the
// unconfigured adapter, so automated billing stays honest until a real Fiserv/Clover merchant + saved card vault are
// wired in. To enable real charging, construct MembershipBillingService with a CardPointeMembershipChargeAdapter.
import { Module } from '@nestjs/common';
import { MembershipBillingController } from './membership-billing.controller';
import { MembershipBillingService } from './membership-billing.service';
import { InMemoryMembershipBillingRepository, type MembershipBillingRepositoryPort } from './membership-billing.repository';
import { KyselyMembershipBillingRepository } from './membership-billing.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { MembershipCommsModule } from './membership-comms.module';
import { MembershipCommsService } from './membership-comms.service';
import type { MembershipChargePort } from './membership-billing.service';
import { MembershipRenewalScheduler } from './membership-renewal.scheduler';
import { MembershipFirstPaymentController } from './membership-first-payment.controller';

@Module({
  controllers: [MembershipBillingController, MembershipFirstPaymentController],
  imports: [MembershipCommsModule],
  providers: [
    { provide: 'MembershipBillingRepositoryPort', useFactory: (db: AppDatabase): MembershipBillingRepositoryPort => (db ? new KyselyMembershipBillingRepository(db as any) : new InMemoryMembershipBillingRepository()), inject: [DATABASE] },
    // 'MembershipChargePort' is supplied by the API's composition root (apps/api/src/common/membership-charge.wiring.ts) when
    // MEMBERSHIP_AUTOBILL_ENABLED=1 — memberships must not depend on the payments module (a module cycle). Absent, the
    // service keeps its unconfigured adapter and the sweep reports not_configured, as it always has.
    { provide: MembershipBillingService, useFactory: (repo: MembershipBillingRepositoryPort, comms: MembershipCommsService, charger?: MembershipChargePort) => new MembershipBillingService(repo, charger, comms), inject: ['MembershipBillingRepositoryPort', MembershipCommsService, { token: 'MembershipChargePort', optional: true }] },
    // w4 sweep SW-17: the in-process scheduler that actually runs renewals + reminders (MEMBERSHIP_RENEWALS_CRON_ENABLED)
    { provide: MembershipRenewalScheduler, useFactory: (b: MembershipBillingService, c: MembershipCommsService) => new MembershipRenewalScheduler(b, c), inject: [MembershipBillingService, MembershipCommsService] },
  ],
  exports: [MembershipBillingService],
})
export class MembershipBillingModule {}
