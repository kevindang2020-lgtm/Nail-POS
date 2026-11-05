import { Module } from '@nestjs/common';
import { GiftCardStockController } from './gift-card-stock.controller';
import { GiftCardStockService } from './gift-card-stock.service';
import { KyselyGiftCardStockRepo, InMemoryGiftCardStockRepo, type GiftCardStockRepo } from './gift-card-stock.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [GiftCardStockController],
  providers: [
    { provide: 'GiftCardStockRepo', useFactory: (db: AppDatabase): GiftCardStockRepo => (db ? new KyselyGiftCardStockRepo(db) : new InMemoryGiftCardStockRepo()), inject: [DATABASE] },
    { provide: GiftCardStockService, useFactory: (repo: GiftCardStockRepo) => new GiftCardStockService(repo), inject: ['GiftCardStockRepo'] },
  ],
  exports: [GiftCardStockService],
})
export class GiftCardStockModule {}
