// voice-call-outcome.vitest.spec.ts — the call-outcome store: honest normalization (never fabricate) + idempotent record.
import { describe, it, expect } from 'vitest';
import { normalizeCallOutcome, CallOutcomeValidationError } from './voice-call-outcome-core';
import { VoiceCallOutcomeService, InMemoryCallOutcomeRepo } from './voice-call-outcome.service';

const V = { tenantId: 'ten_1', branchId: 'br_1' };

describe('normalizeCallOutcome', () => {
  it('requires providerCallId', () => {
    expect(() => normalizeCallOutcome({ providerCallId: '' })).toThrow(CallOutcomeValidationError);
  });

  it('absent fields become null (never fabricated); counts clamp to >= 0', () => {
    const n = normalizeCallOutcome({ providerCallId: 'call_1' });
    expect(n.language).toBeNull();
    expect(n.bookingOutcome).toBeNull();
    expect(n.summary).toBeNull();
    expect(n.intents).toEqual([]);
    expect(n.toolCalls).toEqual([]);
    expect(n.interruptionCount).toBe(0);
    expect(n.abandoned).toBe(false);
  });

  it('sanitizes intents and tool calls', () => {
    const n = normalizeCallOutcome({ providerCallId: 'c', intents: ['BOOK', 42, '', 'ASK_HOURS'], toolCalls: [{ name: 'get_availability', ok: true }, { ok: false }] });
    expect(n.intents).toEqual(['BOOK', 'ASK_HOURS']);
    expect(n.toolCalls).toEqual([{ name: 'get_availability', ok: true }, { name: 'unknown', ok: false }]);
  });

  it('clamps negative counts to zero', () => {
    const n = normalizeCallOutcome({ providerCallId: 'c', interruptionCount: -5, repeatedQuestionCount: 3.9 });
    expect(n.interruptionCount).toBe(0);
    expect(n.repeatedQuestionCount).toBe(3);
  });
});

describe('VoiceCallOutcomeService', () => {
  it('records an outcome and reads it back', async () => {
    const svc = new VoiceCallOutcomeService(new InMemoryCallOutcomeRepo());
    const rec = await svc.record(V, 'retell', { providerCallId: 'call_9', bookingOutcome: 'booked', intents: ['BOOK_APPOINTMENT'] });
    expect(rec.tenantId).toBe('ten_1');
    expect(rec.bookingOutcome).toBe('booked');
    const got = await svc.get('ten_1', 'call_9');
    expect(got?.id).toBe(rec.id);
  });

  it('is idempotent by (tenant, call) — a retry updates, does not duplicate', async () => {
    const repo = new InMemoryCallOutcomeRepo();
    const svc = new VoiceCallOutcomeService(repo);
    const first = await svc.record(V, 'retell', { providerCallId: 'call_9', bookingOutcome: 'none' });
    const second = await svc.record(V, 'retell', { providerCallId: 'call_9', bookingOutcome: 'booked', summary: 'Booked gel mani.' });
    expect(second.id).toBe(first.id);            // same row
    const list = await svc.list('ten_1');
    expect(list).toHaveLength(1);                // not duplicated
    expect(list[0].bookingOutcome).toBe('booked'); // updated
  });

  it('does not leak another tenant\'s outcomes', async () => {
    const svc = new VoiceCallOutcomeService(new InMemoryCallOutcomeRepo());
    await svc.record(V, 'retell', { providerCallId: 'call_A' });
    await svc.record({ tenantId: 'ten_2', branchId: 'br_2' }, 'retell', { providerCallId: 'call_B' });
    expect(await svc.get('ten_1', 'call_B')).toBeNull();
    expect((await svc.list('ten_1'))).toHaveLength(1);
  });
});
