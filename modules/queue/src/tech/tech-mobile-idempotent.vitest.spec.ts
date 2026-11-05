// tech-mobile-idempotent.vitest.spec — BUILD_PLAN Phase 13 (Constitution 6 §15, §21–22): the Technician App sends ONE
// Idempotency-Key per start / complete service and its offline journal replays with that same key after a reconnect or
// a crash. These routes carry @Idempotent(): the same key runs once and the retry gets the stored answer (the
// interceptor's own behaviour is proven on real Postgres in apps/api/src/common/idempotency.postgres-race.vitest.spec.ts).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { TechController } from './tech.controller';

describe('technician service transitions are idempotent', () => {
  it.each(['start', 'done'] as const)('%s carries @Idempotent()', (m) => {
    expect(Reflect.getMetadata('aps:idempotent', (TechController.prototype as any)[m])).toEqual({ required: false });
  });
});
