import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { InMemoryPromotionsRepository, type PromotionsRepositoryPort } from './promotions.repository';
import { KyselyPromotionsRepository } from './promotions.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';

@Module({
  imports: [EventsCoreModule],   // the outbox writer — coupon.redeemed (Oct 3 2026)
  controllers: [PromotionsController],
  providers: [
    { provide: 'PromotionsRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): PromotionsRepositoryPort => (db ? new KyselyPromotionsRepository(db, outbox ?? null) : new InMemoryPromotionsRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: PromotionsService, useFactory: (repo: PromotionsRepositoryPort) => new PromotionsService(repo), inject: ['PromotionsRepositoryPort'] },
  ],
  exports: [PromotionsService],
})
export class PromotionsModule {}
