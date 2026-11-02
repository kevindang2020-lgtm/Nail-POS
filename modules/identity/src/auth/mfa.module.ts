// mfa.module.ts — TOTP enrollment endpoints. Uses the global DATABASE handle directly (reads/writes mfa_factors +
// users.mfa_enabled). Routes are authenticated via the global TenantContextMiddleware (req.ctx).
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { KyselyAuthEvents } from './auth-events';
import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaRecoveryController } from './mfa-recovery.controller';
import { AccountController } from './account.controller';

@Module({ controllers: [MfaController, AccountController, MfaRecoveryController],
  // Constitution 3 Step 5: the auth event log (null without a database)
  providers: [{ provide: KyselyAuthEvents, useFactory: (db: AppDatabase) => (db ? new KyselyAuthEvents(db) : null), inject: [DATABASE] }] })   // Constitution 7 §24: MFA recovery
export class MfaModule {}
