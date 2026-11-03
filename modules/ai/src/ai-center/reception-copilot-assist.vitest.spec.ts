// reception-copilot-assist.vitest.spec.ts — the newly-closed Copilot capabilities (spec §1).
import { describe, it, expect, vi } from 'vitest';
import { ReceptionCopilotAssistService } from './reception-copilot-assist.service';

const ctx = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'MANAGER', permissions: [] } as any;

describe('recommendNextActions (§1 safe next actions)', () => {
  const svc = new ReceptionCopilotAssistService(null as any, {} as any, {} as any);
  it('suggests availability search for a booking intent, and waitlist when nothing is free', () => {
    const a = svc.recommendNextActions({ intent: 'book_appointment', hasAvailability: false });
    expect(a.map((x) => x.action)).toEqual(expect.arrayContaining(['search_availability', 'offer_waitlist']));
  });
  it('prepends a duplicate review when a duplicate is found, and caps at 4', () => {
    const a = svc.recommendNextActions({ intent: 'book_appointment', hasAvailability: true, duplicateFound: true, customerKnown: true });
    expect(a[0].action).toBe('review_duplicates');
    expect(a.length).toBeLessThanOrEqual(4);
  });
  it('handles cancel / reschedule / queue intents distinctly', () => {
    expect(svc.recommendNextActions({ intent: 'cancel_appointment' })[0].action).toBe('confirm_cancellation');
    expect(svc.recommendNextActions({ intent: 'reschedule_appointment' })[0].action).toBe('find_reschedule_options');
    expect(svc.recommendNextActions({ intent: 'queue_status' })[0].action).toBe('summarize_queue');
  });
});

describe('recommendWaitlist (§1 waitlist/standby)', () => {
  it('reuses the real queue summary and returns standby guidance', async () => {
    const context = { queueSummary: vi.fn(async () => ({ waiting: 3, longestWaitMinutes: 25 })) };
    const svc = new ReceptionCopilotAssistService(null as any, {} as any, context as any);
    const r = await svc.recommendWaitlist(ctx);
    expect(r.recommended).toBe(true);
    expect(r.waiting).toBe(3);
    expect(r.estimatedWaitMinutes).toBeNull();          // the longest CURRENT wait is not an estimate
    expect(r.message).toMatch(/standby/i); expect(r.message).toMatch(/25 min/);
  });
  it('Nov 3 audit: an unreadable queue is said so — never "0 waiting, a quick turnaround"', async () => {
    const svc = new ReceptionCopilotAssistService(null as any, {} as any, { queueSummary: vi.fn(async () => { throw new Error('down'); }) } as any);
    const r = await svc.recommendWaitlist(ctx);
    expect(r.recommended).toBe(false); expect(r.message).toMatch(/could not be read/);
    expect(r.message).not.toMatch(/quick turnaround/);
  });
});

describe('explainService (§1 service/policy explanation)', () => {
  it('returns real service fields + policies, reusing the services catalog', async () => {
    const services = { list: vi.fn(async () => [{ serviceId: 's1', name: 'Gel Manicure', categoryName: 'Nails', durationMinutes: 45, priceCents: 4500, description: 'Long-lasting gel.' }]) };
    const svc = new ReceptionCopilotAssistService(null as any, services as any, {} as any);
    const r = await svc.explainService(ctx, { serviceId: 's1' });
    expect(r.found).toBe(true);
    expect(r.service.name).toBe('Gel Manicure');
    expect(r.policies!.some((p) => /policy/i.test(p))).toBe(true);
  });
  it('returns not-found for an unknown service and when no branch context', async () => {
    const services = { list: vi.fn(async () => []) };
    const svc = new ReceptionCopilotAssistService(null as any, services as any, {} as any);
    expect((await svc.explainService(ctx, { serviceId: 'nope' })).found).toBe(false);
    expect((await svc.explainService({ ...ctx, branchId: null }, { serviceId: 's1' })).found).toBe(false);
  });
});

describe('recentAiPhoneActivity (§1 display AI-phone actions)', () => {
  it('returns empty (available:false) with no DB', async () => {
    const svc = new ReceptionCopilotAssistService(null as any, {} as any, {} as any);
    expect(await svc.recentAiPhoneActivity(ctx)).toEqual({ available: false, calls: [] });
  });
});

describe('§47 settings gate the assist capabilities', () => {
  const settings = (overrides: any) => ({ get: async () => ({ allowAiPhoneActivity: true, allowExplainServices: true, allowWaitlist: true, ...overrides }) }) as any;
  it('waitlist suggestions off → recommended:false', async () => {
    const context = { queueSummary: async () => ({ waiting: 3, longestWaitMinutes: 25 }) };
    const svc = new ReceptionCopilotAssistService(null as any, {} as any, context as any, settings({ allowWaitlist: false }));
    const r = await svc.recommendWaitlist(ctx);
    expect(r.recommended).toBe(false);
    expect(r.message).toMatch(/turned off/i);
  });
  it('explain-services off → found:false even for a real service', async () => {
    const services = { list: async () => [{ serviceId: 's1', name: 'Gel', categoryName: 'Nails', durationMinutes: 45, priceCents: 4500 }] };
    const svc = new ReceptionCopilotAssistService(null as any, services as any, {} as any, settings({ allowExplainServices: false }));
    expect((await svc.explainService(ctx, { serviceId: 's1' })).found).toBe(false);
  });
  it('ai-phone activity off → available:false', async () => {
    const svc = new ReceptionCopilotAssistService(null as any, {} as any, {} as any, settings({ allowAiPhoneActivity: false }));
    expect(await svc.recentAiPhoneActivity(ctx)).toEqual({ available: false, calls: [] });
  });
});
