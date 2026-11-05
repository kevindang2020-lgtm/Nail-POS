// customer-security.module.ts — Profile → Security for the Customer App.
// Reuses account-core (password), the sessions table + SessionStore (revocation), and the platform hasher/policy.
// No new user table, no second password system.
import { Module } from '@nestjs/common';
import { CustomerSecurityController } from './customer-security.controller';

@Module({ controllers: [CustomerSecurityController] })
export class CustomerSecurityModule {}
