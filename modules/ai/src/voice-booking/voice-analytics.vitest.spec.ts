// voice-analytics.vitest.spec.ts — the call analytics rollup. Verifies the aggregation math is honest: real
// denominators, null (not 0) when there's no data, correct rates, top intents.
import { describe, it, expect } from 'vitest';
import { summarizeOutcomes, type OutcomeRowForStats } from './voice-analytics-core';
import { VoiceCallOutcomeService, InMemoryCallOutcomeRepo } from './voice-call-outcome.service';

const row = (o: Partial<OutcomeRowForStats> = {}): OutcomeRowForStats => ({
  bookingOutcome: null, handoffOutcome: null, abandoned: false, followUpRequired: false, durationSeconds: null,
  toolCalls: [], intents: [], ...o,
});

describe('summarizeOutcomes', () => {
  it('returns null rates for an empty set (never fabricates a 0% result)', () => {
    const s = summarizeOutcomes([]);
    expect(s.totalCalls).toBe(0);
    expect(s.bookingRatePct).toBeNull();
    expect(s.handoffRatePct).toBeNull();
    expect(s.avgDurationSeconds).toBeNull();
    expect(s.topIntents).toEqual([]);
  });

  it('computes booking / handoff / abandonment rates over the real call count', () => {
    const rows = [
      row({ bookingOutcome: 'booked', durationSeconds: 120, intents: ['BOOK'] }),
      row({ bookingOutcome: 'booked', durationSeconds: 60, intents: ['BOOK'] }),
      row({ handoffOutcome: 'transferred', intents: ['COMPLAINT'] }),
      row({ abandoned: true }),
    ];
    const s = summarizeOutcomes(rows);
    expect(s.totalCalls).toBe(4);
    expect(s.booked).toBe(2);
    expect(s.bookingRatePct).toBe(50);          // 2/4
    expect(s.handoffs).toBe(1);
    expect(s.handoffRatePct).toBe(25);
    expect(s.abandoned).toBe(1);
    expect(s.abandonmentRatePct).toBe(25);
    expect(s.avgDurationSeconds).toBe(90);      // (120+60)/2, only the two that reported duration
  });

  it('counts calls with a tool failure and follow-ups', () => {
    const rows = [
      row({ toolCalls: [{ name: 'get_availability', ok: false }] }),
      row({ toolCalls: [{ name: 'get_availability', ok: true }] }),
      row({ followUpRequired: true }),
    ];
    const s = summarizeOutcomes(rows);
    expect(s.callsWithToolFailure).toBe(1);
    expect(s.toolFailureRatePct).toBe(Math.round((1000 / 3)) / 10); // 33.3
    expect(s.followUpsNeeded).toBe(1);
  });

  it('ranks top intents by frequency', () => {
    const rows = [row({ intents: ['BOOK', 'HOURS'] }), row({ intents: ['BOOK'] }), row({ intents: ['BOOK', 'HOURS'] })];
    const s = summarizeOutcomes(rows);
    expect(s.topIntents[0]).toEqual({ intent: 'BOOK', count: 3 });
    expect(s.topIntents[1]).toEqual({ intent: 'HOURS', count: 2 });
  });

  it("handoffOutcome 'none' does not count as a handoff", () => {
    const s = summarizeOutcomes([row({ handoffOutcome: 'none' }), row({ handoffOutcome: 'transferred' })]);
    expect(s.handoffs).toBe(1);
  });
});

describe('VoiceCallOutcomeService.summary', () => {
  it('aggregates a tenant\'s recorded calls', async () => {
    const svc = new VoiceCallOutcomeService(new InMemoryCallOutcomeRepo());
    const V = { tenantId: 'ten_1', branchId: 'br_1' };
    await svc.record(V, 'retell', { providerCallId: 'c1', bookingOutcome: 'booked', intents: ['BOOK'] });
    await svc.record(V, 'retell', { providerCallId: 'c2', handoffOutcome: 'transferred' });
    const s = await svc.summary('ten_1');
    expect(s.totalCalls).toBe(2);
    expect(s.booked).toBe(1);
    expect(s.bookingRatePct).toBe(50);
  });

  it('does not mix another tenant\'s calls', async () => {
    const svc = new VoiceCallOutcomeService(new InMemoryCallOutcomeRepo());
    await svc.record({ tenantId: 'ten_1', branchId: 'b' }, 'retell', { providerCallId: 'c1', bookingOutcome: 'booked' });
    await svc.record({ tenantId: 'ten_2', branchId: 'b' }, 'retell', { providerCallId: 'c2', bookingOutcome: 'booked' });
    expect((await svc.summary('ten_1')).totalCalls).toBe(1);
  });
});
