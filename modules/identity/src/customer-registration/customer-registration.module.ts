import { CustomerIdentityModule, CustomerIdentityService } from '@aipowersalon/customers';
import { Module } from '@nestjs/common';
import { CustomerRegistrationController } from './customer-registration.controller';
import { CustomerRegistrationService } from './customer-registration.service';
import { InMemoryCustomerRegistrationRepository, type CustomerRegistrationDataPort } from './customer-registration.repository';
import { KyselyCustomerRegistrationRepository } from './customer-registration.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [CustomerIdentityModule],
  controllers: [CustomerRegistrationController],
  providers: [
    { provide: 'CustomerRegistrationDataPort', useFactory: (db: AppDatabase): CustomerRegistrationDataPort => (db ? new KyselyCustomerRegistrationRepository(db as any) : new InMemoryCustomerRegistrationRepository()), inject: [DATABASE] },
    { provide: CustomerRegistrationService, useFactory: (repo: CustomerRegistrationDataPort, identity: CustomerIdentityService) => new CustomerRegistrationService(repo, identity), inject: ['CustomerRegistrationDataPort', CustomerIdentityService] },
  ],
})
export class CustomerRegistrationModule {}
