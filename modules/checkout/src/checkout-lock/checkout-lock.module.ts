// checkout-lock.module.ts — the checkout-session lock as a SHARED concern. Imported by both the POS checkout module
// (so it can SHOW + RESPECT a mobile lock) and the Owner & Manager Payment App module (which acquires/refreshes locks).
// Depends on neither, so there is no circular dependency between POS and mobile.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { CheckoutLockService } from './checkout-lock.service';
import { CheckoutLockPort, KyselyCheckoutLockRepository, InMemoryCheckoutLockRepository } from './checkout-lock.repository';

@Module({
  providers: [
    { provide: 'CheckoutLockPort', useFactory: (db: AppDatabase): CheckoutLockPort => (db ? new KyselyCheckoutLockRepository(db) : new InMemoryCheckoutLockRepository()), inject: [DATABASE] },
    { provide: CheckoutLockService, useFactory: (repo: CheckoutLockPort) => new CheckoutLockService(repo), inject: ['CheckoutLockPort'] },
  ],
  exports: [CheckoutLockService],
})
export class CheckoutLockModule {}
