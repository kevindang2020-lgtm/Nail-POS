import { Module } from '@nestjs/common';
import { GiftCardSettlementController } from './gift-card-settlement.controller';
import { GiftCardSettlementService } from './gift-card-settlement.service';
import { KyselyGiftCardSettlementRepo, InMemoryGiftCardSettlementRepo, type GiftCardSettlementRepo } from './gift-card-settlement.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [GiftCardSettlementController],
  providers: [
    { provide: 'GiftCardSettlementRepo', useFactory: (db: AppDatabase): GiftCardSettlementRepo => (db ? new KyselyGiftCardSettlementRepo(db) : new InMemoryGiftCardSettlementRepo()), inject: [DATABASE] },
    { provide: GiftCardSettlementService, useFactory: (repo: GiftCardSettlementRepo) => new GiftCardSettlementService(repo), inject: ['GiftCardSettlementRepo'] },
  ],
  exports: [GiftCardSettlementService],
})
export class GiftCardSettlementModule {}
