// dispute-outcome-idempotent.vitest.spec — BUILD_PLAN Phase 12 round 2 (found by R2-B): POST /super-admin/disputes/:id/outcome
// adds funds_recovered_cents on every call and a decided chargeback may be decided again (an override), so a double
// submit — a second click, a retried request — counted the recovered money twice. The route is now @Idempotent(): the
// same Idempotency-Key runs once and the retry gets the stored answer (the interceptor's own behaviour is proven on real
// Postgres in apps/api/src/common/idempotency.postgres-race.vitest.spec.ts); admin-web sends one key per submission.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { DisputesController } from './disputes.controller';

describe('dispute outcome is idempotent', () => {
  it('the outcome route carries @Idempotent()', () => {
    const meta = Reflect.getMetadata('aps:idempotent', DisputesController.prototype.outcome);
    expect(meta).toEqual({ required: false });
  });
});
