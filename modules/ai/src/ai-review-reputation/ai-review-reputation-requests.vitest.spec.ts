// ai-review-reputation-requests.vitest.spec.ts — post-visit review requests. Ethical no-gating (eligibility never sees a
// rating), quiet-hours scheduling, one reminder, idempotency per visit, and opt-out honored at BOTH schedule and send time.
import { describe, it, expect } from 'vitest';
import { evaluateRequestEligibility, computeSendTime, shouldSendReminder, type CompletedVisit } from './ai-review-reputation-requests';
import { ReviewRequestService, type RequestStorePort, type ConsentPort, type DispatchPort } from './ai-review-reputation-requests.service';
import { PLATFORM_DEFAULTS, resolveSettings } from './ai-review-reputation-settings';

const cfg = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { config: { reviewRequest: { ...PLATFORM_DEFAULTS.reviewRequest, enabled: true, oneReminder: true } } } }).config.reviewRequest;
const now = new Date(2026, 6, 15, 12, 0, 0);
const visit = (o: Partial<CompletedVisit> = {}): CompletedVisit => ({ tenantId: 'A', branchId: 'b1', customerId: 'c1', appointmentId: 'ap1', completedAt: new Date(2026, 6, 15, 14, 0, 0).toISOString(), visitValueCents: 5000, ...o });
const clear = { optedOut: false, hasContact: true, lastRequestAt: null, requestsInPeriod: 0 };

describe('eligibility (no gating)', () => {
  it('is eligible when checks clear and never considers a rating', () => {
    expect(evaluateRequestEligibility(visit(), cfg, clear, now).eligible).toBe(true);
    expect(evaluateRequestEligibility.length).toBe(4); // (visit, config, checks, now) — no rating parameter
    expect(evaluateRequestEligibility(visit(), cfg, { ...clear, optedOut: true }, now).reason).toBe('opted_out');
    expect(evaluateRequestEligibility(visit({ customerId: null }), cfg, clear, now).reason).toBe('no_customer');
    expect(evaluateRequestEligibility(visit(), cfg, { ...clear, requestsInPeriod: 1 }, now).reason).toBe('frequency_cap');
    expect(evaluateRequestEligibility(visit(), cfg, { ...clear, lastRequestAt: new Date(2026, 6, 10, 12, 0, 0).toISOString() }, now).reason).toBe('cooldown');
  });
});

describe('scheduling', () => {
  it('shifts out of quiet hours and stays put in allowed windows', () => {
    expect(computeSendTime(new Date(2026, 6, 1, 23, 0, 0).toISOString(), cfg).getHours()).toBe(9);
    expect(computeSendTime(new Date(2026, 6, 1, 14, 0, 0).toISOString(), cfg).getHours()).toBe(16);
  });
  it('sends exactly one reminder', () => {
    expect(shouldSendReminder({ status: 'sent', sentAt: new Date(2026, 6, 12, 0, 0, 0).toISOString(), reminderSent: false, converted: false, optedOut: false }, 48, now, cfg)).toBe(true);
    expect(shouldSendReminder({ status: 'sent', sentAt: new Date(2026, 6, 12, 0, 0, 0).toISOString(), reminderSent: true, converted: false, optedOut: false }, 48, now, cfg)).toBe(false);
    expect(shouldSendReminder({ status: 'sent', sentAt: new Date(2026, 6, 12, 0, 0, 0).toISOString(), reminderSent: false, converted: true, optedOut: false }, 48, now, cfg)).toBe(false);
  });
});

describe('request service', () => {
  function make(optedOut = false) {
    const rows: Record<string, any> = {}; let seq = 0; let dispatched = 0; let optedNow = optedOut;
    const store: RequestStorePort = {
      async findByIdem(_c, k) { const r: any = Object.values(rows).find((x: any) => x.idem === k); return r ? { id: r.id } : null; },
      async create(_c, row) { const id = 'rq' + (++seq); rows[id] = { id, idem: row.idempotencyKey, status: 'scheduled', ...row }; return { id }; },
      async listDue() { return Object.values(rows).filter((x: any) => x.status === 'scheduled') as any; },
      async markStatus(_c, id, st) { rows[id].status = st; }, async recordEvent() {}, async countInPeriod() { return 0; }, async lastRequestAt() { return null; },
    };
    const consent: ConsentPort = { async isOptedOut() { return optedNow; }, async hasContact() { return true; }, async recordOptOut() { optedNow = true; } };
    const dispatch: DispatchPort = { async send() { dispatched++; return { dispatchId: 'd' + dispatched }; } };
    return { svc: new ReviewRequestService(store, consent, dispatch), get dispatched() { return dispatched; }, setOptedOut: (v: boolean) => { optedNow = v; } };
  }
  const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'sys', role: 'SYSTEM', permissions: [] };

  it('schedules idempotently, ignores rating (no gating), and honors opt-out at schedule and send time', async () => {
    const h = make();
    expect((await h.svc.scheduleForCompletedVisit(ctx, visit(), cfg, now)).scheduled).toBe(true);
    expect((await h.svc.scheduleForCompletedVisit(ctx, visit(), cfg, now)).reason).toBe('already_requested');
    expect((await h.svc.scheduleForCompletedVisit(ctx, visit({ appointmentId: 'ap2' }), cfg, now)).scheduled).toBe(true);

    const optedh = make(true);
    expect((await optedh.svc.scheduleForCompletedVisit(ctx, visit(), cfg, now)).reason).toBe('opted_out');

    expect((await h.svc.sendDue(ctx, new Date(2026, 6, 20, 10, 0, 0))).sent).toBe(2);

    const lateh = make(false);
    await lateh.svc.scheduleForCompletedVisit(ctx, visit(), cfg, now);
    lateh.setOptedOut(true);
    const r = await lateh.svc.sendDue(ctx, new Date(2026, 6, 20, 10, 0, 0));
    expect(r.sent).toBe(0); expect(r.skippedOptOut).toBe(1); expect(lateh.dispatched).toBe(0);
  });
});
