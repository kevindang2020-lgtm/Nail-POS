// pos-referrals.module.ts — Kysely-backed when Postgres present, else in-memory (dev/offline/tests). The Referral Program
// center (guide Oct 30 2026, migration 751) lives beside it: `/pos/referral-program/*` (ReferralProgramController).
import { Module } from '@nestjs/common';
import { ReferralsController } from './pos-referrals.controller';
import { ReferralsService } from './pos-referrals.service';
import { InMemoryReferralsRepository, type ReferralsRepositoryPort } from './pos-referrals.repository';
import { KyselyReferralsRepository } from './pos-referrals.kysely.repository';
import { ReferralProgram, type ReferralVoucherPort } from './referral-program';
import { ReferralProgramController, REFERRAL_PROGRAM } from './referral-program.controller';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ReferralsController, ReferralProgramController],
  providers: [
    { provide: 'ReferralsRepositoryPort', useFactory: (db: AppDatabase): ReferralsRepositoryPort => (db ? new KyselyReferralsRepository(db) : new InMemoryReferralsRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: REFERRAL_PROGRAM, useFactory: (db: AppDatabase, vouchers: ReferralVoucherPort | null) => (db ? new ReferralProgram(db, vouchers ?? null) : null), inject: [DATABASE, { token: 'REFERRAL_VOUCHERS', optional: true }] },   // salon vouchers: the deals wallet port (Refer a Friend build Nov 5 2026)
    { provide: ReferralsService, useFactory: (repo: ReferralsRepositoryPort, rp: ReferralProgram | null) => new ReferralsService(repo, rp), inject: ['ReferralsRepositoryPort', REFERRAL_PROGRAM] },
  ],
  exports: [ReferralsService, REFERRAL_PROGRAM],
})
export class ReferralsModule {}
