// voice-gateway-metrics.vitest.spec.ts — the gateway health counters and the interceptor that feeds them.
// Honesty first: an untouched snapshot reads zeros and a NULL success rate (no denominator = no fabricated 100%).
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpException } from '@nestjs/common';
import { VoiceGatewayMetricsService } from './voice-gateway-metrics.service';
import { VoiceGatewayMetricsInterceptor } from './voice-gateway-metrics.interceptor';

describe('VoiceGatewayMetricsService', () => {
  it('an untouched snapshot is all zeros with a NULL success rate (no fabricated denominator)', () => {
    const s = new VoiceGatewayMetricsService().snapshot();
    expect(s).toMatchObject({ totalRequests: 0, totalErrors: 0, successRatePct: null, idempotentReplays: 0, rateLimitEvents: 0, handoffs: 0 });
    expect(s.byOperation).toEqual({});
    expect(typeof s.since).toBe('string');
  });
  it('derives success rate from real requests and errors; rate-limit errors are tallied separately', () => {
    const m = new VoiceGatewayMetricsService();
    m.request('book'); m.request('book'); m.request('availability'); m.request('availability');
    m.error('book', 'SLOT_UNAVAILABLE');
    m.error('availability', 'RATE_LIMIT_EXCEEDED');
    const s = m.snapshot();
    expect(s.totalRequests).toBe(4);
    expect(s.totalErrors).toBe(2);
    expect(s.successRatePct).toBe(50);              // (4-2)/4
    expect(s.rateLimitEvents).toBe(1);
    expect(s.byOperation.book).toEqual({ requests: 2, errors: 1 });
    expect(s.byErrorCode).toEqual({ SLOT_UNAVAILABLE: 1, RATE_LIMIT_EXCEEDED: 1 });
  });
  it('counts idempotent replays and handoffs', () => {
    const m = new VoiceGatewayMetricsService();
    m.replay(); m.replay(); m.handoff();
    const s = m.snapshot();
    expect(s.idempotentReplays).toBe(2);
    expect(s.handoffs).toBe(1);
  });
});

describe('VoiceGatewayMetricsInterceptor', () => {
  const ctx = (handlerName: string) => ({ getHandler: () => ({ name: handlerName }) }) as any;
  const nextOf = (obs: any) => ({ handle: () => obs }) as any;

  it('counts a successful request against the mapped operation', async () => {
    const m = new VoiceGatewayMetricsService();
    const itc = new VoiceGatewayMetricsInterceptor(m);
    await new Promise((res) => itc.intercept(ctx('availability'), nextOf(of({ success: true, data: {} }))).subscribe({ complete: res }));
    const s = m.snapshot();
    expect(s.totalRequests).toBe(1);
    expect(s.byOperation.availability).toEqual({ requests: 1, errors: 0 });
  });
  it('reads the stable error code off a thrown HttpException', async () => {
    const m = new VoiceGatewayMetricsService();
    const itc = new VoiceGatewayMetricsInterceptor(m);
    const err = new HttpException({ success: false, error: { code: 'CONFIRMATION_REQUIRED' } }, 400);
    await new Promise((res) => itc.intercept(ctx('book'), nextOf(throwError(() => err))).subscribe({ error: res }));
    const s = m.snapshot();
    expect(s.byOperation.book).toEqual({ requests: 1, errors: 1 });
    expect(s.byErrorCode).toEqual({ CONFIRMATION_REQUIRED: 1 });
  });
  it('detects an idempotent replay and a successful handoff', async () => {
    const m = new VoiceGatewayMetricsService();
    const itc = new VoiceGatewayMetricsInterceptor(m);
    await new Promise((res) => itc.intercept(ctx('reschedule'), nextOf(of({ success: true, meta: { idempotentReplay: true } }))).subscribe({ complete: res }));
    await new Promise((res) => itc.intercept(ctx('handoff'), nextOf(of({ success: true, data: { handoff: {} } }))).subscribe({ complete: res }));
    const s = m.snapshot();
    expect(s.idempotentReplays).toBe(1);
    expect(s.handoffs).toBe(1);
  });
  it('ignores handlers that are not gateway operations', async () => {
    const m = new VoiceGatewayMetricsService();
    const itc = new VoiceGatewayMetricsInterceptor(m);
    const spy = vi.fn();
    itc.intercept(ctx('somethingElse'), { handle: () => { spy(); return of(1); } } as any);
    expect(spy).toHaveBeenCalled();                 // passed through
    expect(m.snapshot().totalRequests).toBe(0);     // not counted
  });
});
