// approvals-decide-idempotent.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §15): an approval decision retried after a
// lost answer runs once. Both decide routes (Owner App + POS) carry @Idempotent(); the Owner App sends one key per decision.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { OwnerApprovalsController, PosApprovalsController } from './approvals.controller';

describe('approval decisions are idempotent', () => {
  it.each([['owner', OwnerApprovalsController], ['pos', PosApprovalsController]] as const)('%s decide carries @Idempotent()', (_n, C) => {
    expect(Reflect.getMetadata('aps:idempotent', (C as any).prototype.decide)).toEqual({ required: false });
  });
});
