import { OutboxWriter } from '@aipowersalon/events';
import { Module } from '@nestjs/common';
import { PromotionsOversightController } from './promotions-oversight.controller';
import { PromotionsOversightService } from './promotions-oversight.service';
import { InMemoryPromotionsOversightRepository, type PromotionsOversightRepositoryPort } from './promotions-oversight.repository';
import { KyselyPromotionsOversightRepository } from './promotions-oversight.kysely.repository';
import { PromotionManagementController } from './promotion-management.controller';
import { PromotionManagementService } from './promotion-management.service';
import { InMemoryPromotionManagementRepository, KyselyPromotionManagementRepository, type PromotionManagementRepositoryPort } from './promotion-management.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PromotionsOversightController, PromotionManagementController],
  providers: [
    { provide: 'PromotionsOversightRepositoryPort', useFactory: (db: AppDatabase): PromotionsOversightRepositoryPort => (db ? new KyselyPromotionsOversightRepository(db) : new InMemoryPromotionsOversightRepository()), inject: [DATABASE] },
    { provide: PromotionsOversightService, useFactory: (repo: PromotionsOversightRepositoryPort) => new PromotionsOversightService(repo), inject: ['PromotionsOversightRepositoryPort'] },
    { provide: 'PromotionManagementRepositoryPort', useFactory: (db: AppDatabase): PromotionManagementRepositoryPort => (db ? new KyselyPromotionManagementRepository(db, new OutboxWriter()) : new InMemoryPromotionManagementRepository()), inject: [DATABASE] },
    { provide: PromotionManagementService, useFactory: (repo: PromotionManagementRepositoryPort) => new PromotionManagementService(repo), inject: ['PromotionManagementRepositoryPort'] },
  ],
  exports: [PromotionsOversightService, PromotionManagementService],
})
export class PromotionsOversightModule {}
