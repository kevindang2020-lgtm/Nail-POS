// super-admin-merchant-accounts.module.ts — wires the read-only Super Admin Merchant Accounts surface over the
// platform DB, reusing tenant_payment_config + terminals + tenants. No secrets are exposed.
import { Module } from '@nestjs/common';
import { SECRET_SEALERS, type SecretSealers } from '@aipowersalon/security';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminMerchantAccountsService } from './super-admin-merchant-accounts.service';
import { SuperAdminMerchantAccountsRepository } from './super-admin-merchant-accounts.kysely.repository';
import { SuperAdminMerchantAccountsController } from './super-admin-merchant-accounts.controller';

@Module({
  controllers: [SuperAdminMerchantAccountsController],
  providers: [
    {
      provide: SuperAdminMerchantAccountsService,
      useFactory: (db: AppDatabase, sealers: SecretSealers) => new SuperAdminMerchantAccountsService(new SuperAdminMerchantAccountsRepository(db as any), sealers.forPurpose('funding')),
      inject: [DATABASE, SECRET_SEALERS],
    },
  ],
  exports: [SuperAdminMerchantAccountsService],
})
export class SuperAdminMerchantAccountsModule {}
