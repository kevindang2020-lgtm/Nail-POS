// voice-idempotency.pgtest — executes the voice-booking idempotency boundary against the real schema.
//
// This is the one place in the silent-SQL tail where failure is not an empty screen but a DUPLICATE SIDE
// EFFECT. The voice agent retries calls; if the idempotency boundary does not hold, a retried "book me for
// 3pm" books twice.
//
// `begin()` relies on `ON CONFLICT (scope, idem_key)` of api_idempotency — the ONE idempotency store since BUILD_PLAN
// Phase 10 (migration 541 merged voice_gateway_idempotency into it; scope 'voice:<tenant>:<operation>'). An
// in-memory fake cannot prove that; the real schema can, and every test below depends on it.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyVoiceIdempotencyRepo } from './voice-idempotency.service';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = 'a9a9a9a9-0000-4000-8000-000000000001';
const B = 'a9a9a9a9-0000-4000-8000-000000000002';
const ctx = { tenantId: T, branchId: B } as never;
let repo: KyselyVoiceIdempotencyRepo;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Voice Salon LLC', 'Voice Salon', 'voice-salon', 'VOICE1', 'active') ON CONFLICT DO NOTHING;
  `);
  repo = new KyselyVoiceIdempotencyRepo(kyselyFor(pg) as never);
});

describe('the idempotency boundary holds on real Postgres', () => {
  it('the FIRST request proceeds', async () => {
    expect((await repo.begin(ctx, 'book', 'k-1', 'hash-A')).kind).toBe('proceed');
  });

  it('THE PROPERTY: a retry while the first is in flight does NOT proceed — it would book twice', async () => {
    await repo.begin(ctx, 'book', 'k-2', 'hash-A');
    expect((await repo.begin(ctx, 'book', 'k-2', 'hash-A')).kind).toBe('inflight');
  });

  it('a retry after commit REPLAYS the stored response instead of re-executing', async () => {
    await repo.begin(ctx, 'book', 'k-3', 'hash-A');
    await repo.commit(ctx, 'book', 'k-3', { appointmentId: 'appt-77' });
    const again = await repo.begin(ctx, 'book', 'k-3', 'hash-A');
    expect(again.kind).toBe('replay');
    expect((again as { response: { appointmentId: string } }).response.appointmentId).toBe('appt-77');
  });

  it('the same key with a DIFFERENT body is a conflict, not a replay of someone else’s answer', async () => {
    await repo.begin(ctx, 'book', 'k-4', 'hash-A');
    await repo.commit(ctx, 'book', 'k-4', { appointmentId: 'appt-1' });
    expect((await repo.begin(ctx, 'book', 'k-4', 'hash-B')).kind).toBe('conflict');
  });

  it('release frees a PENDING key so a genuine retry can proceed', async () => {
    await repo.begin(ctx, 'book', 'k-5', 'hash-A');
    await repo.release(ctx, 'book', 'k-5');
    expect((await repo.begin(ctx, 'book', 'k-5', 'hash-A')).kind).toBe('proceed');
  });

  it('release does NOT free a COMMITTED key — a completed booking must stay replayable', async () => {
    await repo.begin(ctx, 'book', 'k-6', 'hash-A');
    await repo.commit(ctx, 'book', 'k-6', { appointmentId: 'appt-6' });
    await repo.release(ctx, 'book', 'k-6');
    expect((await repo.begin(ctx, 'book', 'k-6', 'hash-A')).kind).toBe('replay');
  });
});

describe('the boundary is scoped — tenant and operation are both part of the key', () => {
  it('the same key under ANOTHER tenant proceeds independently', async () => {
    await repo.begin(ctx, 'book', 'k-7', 'hash-A');
    const other = { tenantId: 'a8a8a8a8-0000-4000-8000-000000000009', branchId: B } as never;
    expect((await repo.begin(other, 'book', 'k-7', 'hash-A')).kind).toBe('proceed');
  });

  it('the same key under ANOTHER operation proceeds independently', async () => {
    await repo.begin(ctx, 'book', 'k-8', 'hash-A');
    expect((await repo.begin(ctx, 'cancel', 'k-8', 'hash-A')).kind).toBe('proceed');
  });
});

// The SELECT inside begin() only runs when the INSERT conflicts — i.e. for a retry within the SAME tenant.
// A different tenant's first request never reaches it, which is why an earlier version of the cross-tenant test
// above could not detect a missing tenant predicate there. This case reaches the SELECT with another tenant's
// committed row already sharing the operation and key. Without `tenant_id = …` in that lookup, LIMIT 1 can
// return THEIR row and replay THEIR booking response — a cross-tenant leak through the retry path.
describe('a retry never replays ANOTHER tenant’s committed response', () => {
  it('tenant B retrying its own in-flight key sees in-flight, not tenant A’s committed booking', async () => {
    const A = ctx;
    const Bctx = { tenantId: 'a7a7a7a7-0000-4000-8000-000000000007', branchId: B } as never;
    await repo.begin(A, 'book', 'shared-key', 'same-hash');
    await repo.commit(A, 'book', 'shared-key', { appointmentId: 'TENANT-A-SECRET' });

    await repo.begin(Bctx, 'book', 'shared-key', 'same-hash');          // B's first attempt → pending
    const retry = await repo.begin(Bctx, 'book', 'shared-key', 'same-hash');

    expect(retry.kind).toBe('inflight');
    expect(JSON.stringify(retry)).not.toContain('TENANT-A-SECRET');
  });
});
