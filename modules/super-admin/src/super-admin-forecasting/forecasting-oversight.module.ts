import { Module } from '@nestjs/common';
import { ForecastingOversightController } from './forecasting-oversight.controller';
import { ForecastingOversightService } from './forecasting-oversight.service';
import { InMemoryForecastingOversightRepository, type ForecastingOversightRepositoryPort } from './forecasting-oversight.repository';
import { KyselyForecastingOversightRepository } from './forecasting-oversight.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ForecastingOversightController],
  providers: [
    { provide: 'ForecastingOversightRepositoryPort', useFactory: (db: AppDatabase): ForecastingOversightRepositoryPort => (db ? new KyselyForecastingOversightRepository(db) : new InMemoryForecastingOversightRepository()), inject: [DATABASE] },
    { provide: ForecastingOversightService, useFactory: (repo: ForecastingOversightRepositoryPort) => new ForecastingOversightService(repo), inject: ['ForecastingOversightRepositoryPort'] },
  ],
  exports: [ForecastingOversightService],
})
export class ForecastingOversightModule {}
