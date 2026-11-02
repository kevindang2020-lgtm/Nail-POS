import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AccountRepository } from './account.repository';
import { AccountService } from './account.service';
import { CustomerAccountController, OwnerAccountController, TechAccountController, PrivacyExportController } from './account.controllers';
import { LanguageController, LanguageService } from './language.controller';   // BUILD_PLAN Phase 13 (C6 §97–98): the user's app language

@Module({
  controllers: [CustomerAccountController, OwnerAccountController, TechAccountController, PrivacyExportController, LanguageController],
  providers: [
    { provide: AccountRepository, useFactory: (db: AppDatabase) => new AccountRepository(db as any), inject: [DATABASE] },
    { provide: LanguageService, useFactory: (db: AppDatabase) => new LanguageService(db as any), inject: [DATABASE] },
    { provide: AccountService, useFactory: (repo: AccountRepository) => new AccountService(repo), inject: [AccountRepository] },
  ],
  exports: [AccountService],
})
export class AccountModule {}
