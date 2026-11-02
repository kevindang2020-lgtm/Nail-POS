import { Module } from '@nestjs/common';
import { BusinessCategoriesController } from './business-categories.controller';
import { BusinessCategoriesService } from './business-categories.service';
import { KyselyBizCategoriesRepo, InMemoryBizCategoriesRepo, type BizCategoriesRepo } from './business-categories.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [BusinessCategoriesController],
  providers: [
    { provide: 'BizCategoriesRepo', useFactory: (db: AppDatabase): BizCategoriesRepo => (db ? new KyselyBizCategoriesRepo(db) : new InMemoryBizCategoriesRepo()), inject: [DATABASE] },
    { provide: BusinessCategoriesService, useFactory: (repo: BizCategoriesRepo, db: AppDatabase) => new BusinessCategoriesService(repo, db || undefined), inject: ['BizCategoriesRepo', DATABASE] },
  ],
  exports: [BusinessCategoriesService],
})
export class BusinessCategoriesModule {}
