// realtime-envelope-at-port.vitest.spec.ts — §12/§19/§20 enforced at the emitter ports (Jul 28, 2026).
// 68 emit sites predate the envelope; instead of editing each, the ports seal every payload. Pinned here:
//   1. a raw payload leaves the port as a REAL envelope (eventId/updatedAt/tenant/branch), data preserved
//   2. an emit-site envelope passes through UNTOUCHED — same eventId, no double wrap
//   3. forbidden keys are STRIPPED (recursively, arrays included) and counted — they never reach a subscriber
//   4. across the two-node bus, ONE identity: the envelope is created on the origin node and crosses as-is
import { describe, it, expect } from 'vitest';
import { ensureEnvelope, isEnvelope, makeEnvelope, EVENTS } from '@aipowersalon/realtime-contracts';
import { InProcessEmitter } from './realtime.gateway';
import { RedisRealtimeEmitter, type RealtimePubSub } from './realtime-bus';

const ctx = { tenantId: 't-1', branchId: 'b-1' } as any;

describe('ensureEnvelope', () => {
  it('wraps a raw payload into a real envelope and preserves the data', () => {
    const { envelope, piiStripped } = ensureEnvelope(EVENTS.queueUpdated, { queueItemId: 'q1' }, ctx);
    expect(isEnvelope(envelope)).toBe(true);
    expect(envelope.eventType).toBe(EVENTS.queueUpdated);
    expect(envelope.tenantId).toBe('t-1');
    expect(envelope.branchId).toBe('b-1');
    expect(envelope.data).toEqual({ queueItemId: 'q1' });
    expect(typeof envelope.eventId).toBe('string');
    expect(piiStripped).toBe(0);
  });

  it('passes an existing envelope through untouched — the eventId is created exactly once', () => {
    const built = makeEnvelope({ eventType: EVENTS.queueUpdated, tenantId: 't-1', resourceType: 'appointment', resourceId: 'a1', version: 7 });
    const { envelope } = ensureEnvelope(EVENTS.queueUpdated, built, ctx);
    expect(envelope).toBe(built);
    expect(envelope.eventId).toBe(built.eventId);
    expect(envelope.version).toBe(7);
  });

  it('strips forbidden keys recursively (arrays included) and counts them — identifiers stay', () => {
    const { envelope, piiStripped } = ensureEnvelope(EVENTS.queueUpdated, {
      queueItemId: 'q1', phone: '555-1234',
      customer: { id: 'c1', email: 'x@y.z', tags: [{ notes: 'secret', label: 'vip' }] },
    }, ctx);
    expect(piiStripped).toBe(3);
    expect(JSON.stringify(envelope)).not.toMatch(/555-1234|x@y\.z|secret/);
    expect(envelope.data).toEqual({ queueItemId: 'q1', customer: { id: 'c1', tags: [{ label: 'vip' }] } });
  });

  it('non-object payloads are carried as { value }, null as no data', () => {
    expect(ensureEnvelope(EVENTS.queueUpdated, 'hello', ctx).envelope.data).toEqual({ value: 'hello' });
    expect(ensureEnvelope(EVENTS.queueUpdated, null, ctx).envelope.data).toBeUndefined();
  });
});

describe('the ports seal every payload', () => {
  it('a legacy raw emit reaches subscribers as an envelope, and stripping is metered', () => {
    const em = new InProcessEmitter();
    const got: any[] = [];
    em.subscribe('tenant:t-1:branch:b-1', (e) => got.push(e.payload));
    em.toTenant(ctx, EVENTS.queueUpdated, { queueItemId: 'q1', phone: '555' });
    expect(got).toHaveLength(1);
    expect(isEnvelope(got[0])).toBe(true);
    expect(got[0].data).toEqual({ queueItemId: 'q1' });
    expect(em.metrics.piiStripped).toBe(1);
  });

  it('two-node bus: both nodes deliver the SAME eventId (origin-node envelope crosses as-is)', async () => {
    // In-memory pub/sub acting as two nodes on one channel — the established test double for the bus.
    const handlers: ((m: string) => void)[] = [];
    const pubsub: RealtimePubSub = {
      publish: async (_c, m) => { for (const h of handlers) h(m); },
      subscribe: async (_c, h) => { handlers.push(h); },
    } as any;
    const localA = new InProcessEmitter(); const localB = new InProcessEmitter();
    const nodeA = new RedisRealtimeEmitter(localA, pubsub); const nodeB = new RedisRealtimeEmitter(localB, pubsub);
    await nodeA.init(); await nodeB.init();
    const gotA: any[] = []; const gotB: any[] = [];
    localA.subscribe('tenant:t-1:branch:b-1', (e) => gotA.push(e.payload));
    localB.subscribe('tenant:t-1:branch:b-1', (e) => gotB.push(e.payload));
    nodeA.toTenant(ctx, EVENTS.queueUpdated, { queueItemId: 'q1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(gotA).toHaveLength(1);
    expect(gotB).toHaveLength(1);
    expect(isEnvelope(gotA[0])).toBe(true);
    expect(gotA[0].eventId).toBe(gotB[0].eventId);
  });
});
