// code-lookup-limit.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12): the customer app's lookup by secret code
// (the gift-claim token) is limited too, and the API provides the shared store the interceptor uses (not the
// process-local fallback). The POS routes are pinned in modules/checkout code-lookup-limit-routes spec; the store's
// concurrency on real Postgres in code-lookup-limit.postgres-race.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { CODE_LOOKUP_KIND } from '@aipowersalon/security/nest';
import { CODE_LOOKUP_STORE, InMemoryCodeLookupStore } from '@aipowersalon/security';
import { CustomerController } from '../customer/customer.controller';
import { RateLimitModule } from './rate-limit.module';
import { PostgresCodeLookupStore } from './code-lookup-limit.store';

describe('lookup-by-code limit wiring', () => {
  it('the customer gift-claim route is limited as a gift_claim lookup', () => {
    expect(Reflect.getMetadata(CODE_LOOKUP_KIND, (CustomerController.prototype as any).claimGiftCard)).toBe('gift_claim');
  });
  it('the global RateLimitModule provides and exports the store: Postgres with a database, in-memory without', () => {
    const providers: any[] = Reflect.getMetadata('providers', RateLimitModule);
    const exportsList: any[] = Reflect.getMetadata('exports', RateLimitModule);
    const p = providers.find((x) => x?.provide === CODE_LOOKUP_STORE);
    expect(p).toBeTruthy();
    expect(exportsList).toContain(CODE_LOOKUP_STORE);
    expect(p.useFactory({ transaction: () => null })).toBeInstanceOf(PostgresCodeLookupStore);
    expect(p.useFactory(null)).toBeInstanceOf(InMemoryCodeLookupStore);
  });
});
