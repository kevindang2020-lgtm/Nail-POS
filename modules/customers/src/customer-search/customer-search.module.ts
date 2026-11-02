// customer-search.module.ts — Customer Search guide (Nov 1 2026): the read layer over the authorized customer directory.
// Postgres only — without a database the controller answers 503 SERVICE_UNAVAILABLE (never an empty "no customers").
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CustomerSearchCenter } from './customer-search-center';
import { CustomerSearchCenterController, CUSTOMER_SEARCH_CENTER } from './customer-search-center.controller';

@Module({
  controllers: [CustomerSearchCenterController],
  providers: [{ provide: CUSTOMER_SEARCH_CENTER, useFactory: (db: AppDatabase) => (db ? new CustomerSearchCenter(db) : null), inject: [DATABASE] }],
})
export class CustomerSearchModule {}
