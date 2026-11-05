import { Module } from '@nestjs/common';
import { GiftCardProgramsController } from './gift-card-programs.controller';
import { GiftCardProgramsService } from './gift-card-programs.service';
import { KyselyGiftCardProgramsRepo, InMemoryGiftCardProgramsRepo, type GiftCardProgramsRepo } from './gift-card-programs.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [GiftCardProgramsController],
  providers: [
    { provide: 'GiftCardProgramsRepo', useFactory: (db: AppDatabase): GiftCardProgramsRepo => (db ? new KyselyGiftCardProgramsRepo(db) : new InMemoryGiftCardProgramsRepo()), inject: [DATABASE] },
    { provide: GiftCardProgramsService, useFactory: (repo: GiftCardProgramsRepo) => new GiftCardProgramsService(repo), inject: ['GiftCardProgramsRepo'] },
  ],
  exports: [GiftCardProgramsService],
})
export class GiftCardProgramsModule {}
