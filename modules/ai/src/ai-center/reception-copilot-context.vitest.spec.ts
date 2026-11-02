// reception-copilot-context.vitest.spec.ts — the read-only context backbone. Verifies match states (unknown / exact /
// multiple), phone masking, that it delegates to CustomersService with the SERVER-derived tenant context (never a
// client-supplied one), and that a permission error becomes an honest denied state rather than a crash.
import { describe, it, expect, vi } from 'vitest';
import { ReceptionCopilotContextService, normalizePhone, maskPhone, draftMessageBody, classifyIntent, cleanSmsDraft } from './reception-copilot-context.service';

const ctx = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'RECEPTION', permissions: ['pos.customers.view'] };
const item = (over: any = {}) => ({ customerId: 'c1', fullName: 'Ann Lee', phone: '+1 (856) 555-1234', visitsCount: 4, lastVisitDate: '2026-06-20', loyaltyTier: 'gold', favoriteTechnicianName: 'Amy', favoriteServiceName: 'Gel Mani', ...over });

function svc(searchImpl: any, apptImpl: any = async () => [], queueImpl: any = async () => ({ items: [] }), dupImpl: any = async () => [], availImpl: any = async () => [], conflictImpl: any = async () => ({ status: 'ok' })) {
  const customers = { search: vi.fn(searchImpl), appointments: vi.fn(apptImpl), duplicates: vi.fn(dupImpl) };
  const queue = { items: vi.fn(queueImpl) };
  const booking = { availability: vi.fn(availImpl), checkConflict: vi.fn(conflictImpl) };
  return { s: new ReceptionCopilotContextService(customers as any, queue as any, booking as any), customers, queue, booking };
}

describe('helpers', () => {
  it('normalizes and masks phone to last 4', () => {
    expect(normalizePhone('+1 (856) 555-1234')).toBe('18565551234');
    expect(maskPhone('+1 (856) 555-1234')).toBe('•••• 1234');
  });
});

describe('ReceptionCopilotContextService', () => {
  it('unknown caller → matchState none', async () => {
    const { s } = svc(async () => ({ items: [], pagination: {} }));
    const r = await s.customerContext(ctx as any, { phone: '8565550000' });
    expect(r.matchState).toBe('none');
    expect(r.customer).toBeNull();
  });

  it('single exact phone match → exact, with masked phone and upcoming appointment', async () => {
    const { s } = svc(async () => ({ items: [item()], pagination: {} }), async () => [
      { appointmentId: 'a1', startsAt: '2999-07-12T14:00:00Z', serviceName: 'Pedicure', technicianName: 'Amy', status: 'booked' },
    ]);
    const r = await s.customerContext(ctx as any, { phone: '(856) 555-1234' });
    expect(r.matchState).toBe('exact');
    expect(r.customer?.maskedPhone).toBe('•••• 1234');
    expect(r.customer?.returning).toBe(true);
    expect(r.customer?.upcomingAppointment).toMatchObject({ serviceName: 'Pedicure' });
  });

  it('multiple matches → multiple, candidates only (no auto-pick)', async () => {
    const { s } = svc(async () => ({ items: [item(), item({ customerId: 'c2', fullName: 'Ann Li' })], pagination: {} }));
    const r = await s.customerContext(ctx as any, { phone: '8565551234' });
    expect(r.matchState).toBe('multiple');
    expect(r.candidates.length).toBe(2);
    expect(r.customer).toBeNull();
  });

  it('delegates with the SERVER tenant context (isolation)', async () => {
    const { s, customers } = svc(async () => ({ items: [], pagination: {} }));
    await s.customerContext(ctx as any, { phone: '1234' });
    expect(customers.search).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), expect.anything());
  });

  it('permission error → honest denied state, not a crash', async () => {
    const { s } = svc(async () => { const e: any = new Error('Missing pos.customers.view'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.customerContext(ctx as any, { phone: '1234' });
    expect(r.denied).toBe(true);
    expect(r.matchState).toBe('none');
  });
});

describe('queueSummary', () => {
  const qitem = (over: any = {}) => ({ queueItemId: 'q1', customerName: 'X', status: 'waiting', assignedTechnicianName: null, isVip: false, actualWaitMinutes: 10, ...over });

  it('returns available:false when no branch is in context (no fabricated zeros)', async () => {
    const { s } = svc(async () => ({ items: [] }));
    const r = await s.queueSummary({ ...ctx, branchId: null } as any);
    expect(r.available).toBe(false);
  });

  it('summarizes waiting / in-service / unassigned / vip / longest wait from real items', async () => {
    const items = [
      qitem({ status: 'waiting', actualWaitMinutes: 28, isVip: true }),
      qitem({ queueItemId: 'q2', status: 'assigned', assignedTechnicianName: 'Amy', actualWaitMinutes: 5 }),
      qitem({ queueItemId: 'q3', status: 'in_service', assignedTechnicianName: 'Bea' }),
      qitem({ queueItemId: 'q4', status: 'waiting', assignedTechnicianName: null, actualWaitMinutes: 12 }),
      qitem({ queueItemId: 'q5', status: 'cancelled' }),
    ];
    const { s, queue } = svc(async () => ({ items: [] }), async () => [], async () => ({ items }));
    const r = await s.queueSummary(ctx as any);
    expect(queue.items).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }));
    expect(r).toMatchObject({ available: true, waiting: 3, inService: 1, unassigned: 2, vipWaiting: 1, longestWaitMinutes: 28 });
  });

  it('permission error → denied', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => { const e: any = new Error('Missing pos.queue.view'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.queueSummary(ctx as any);
    expect(r.denied).toBe(true);
  });
});

describe('duplicateCandidates', () => {
  it('projects real duplicate groups with masked phones (review-only, no merge)', async () => {
    const groups = [{ duplicateGroupId: 'g1', reason: 'same phone', members: [
      { customerId: 'c1', displayName: 'Ann Lee', phone: '+1 856 555 1234', visitCount: 4 },
      { customerId: 'c2', displayName: 'Ann Li', phone: '8565551234', visitCount: 1 },
    ] }];
    const { s, customers } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => groups);
    const r = await s.duplicateCandidates(ctx as any);
    expect(customers.duplicates).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }));
    expect(r.groups[0].reason).toBe('same phone');
    expect(r.groups[0].members[0]).toMatchObject({ customerId: 'c1', fullName: 'Ann Lee', maskedPhone: '•••• 1234' });
  });

  it('permission error → denied', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => { const e: any = new Error('Missing pos.customers.view'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.duplicateCandidates(ctx as any);
    expect(r.denied).toBe(true);
    expect(r.groups).toEqual([]);
  });
});

describe('recommendAvailability', () => {
  it('flattens the real availability engine into earliest-first recommendations + per-tech breakdown', async () => {
    const perTech = [
      { technicianId: 't1', name: 'Amy', slots: ['10:00', '11:30', '14:00'] },
      { technicianId: 't2', name: 'Bea', slots: ['09:30', '13:00'] },
    ];
    const { s, booking } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => perTech);
    const r = await s.recommendAvailability(ctx as any, { date: '2026-07-10', serviceIds: ['svc1'] });
    expect(booking.availability).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), { date: '2026-07-10', serviceIds: ['svc1'], technicianId: undefined });
    expect(r.available).toBe(true);
    expect(r.recommendations[0]).toMatchObject({ time: '09:30', technicianName: 'Bea' });  // earliest across techs
    expect(r.recommendations.length).toBeLessThanOrEqual(6);
    expect(r.byTechnician.find((t) => t.technicianId === 't1')).toMatchObject({ slotCount: 3, firstSlot: '10:00' });
  });

  it('no branch → available:false (honest)', async () => {
    const { s } = svc(async () => ({ items: [] }));
    const r = await s.recommendAvailability({ ...ctx, branchId: null } as any, {});
    expect(r.available).toBe(false);
  });

  it('empty availability → available:false, no fabricated slots', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => [{ technicianId: 't1', name: 'Amy', slots: [] }]);
    const r = await s.recommendAvailability(ctx as any, {});
    expect(r.available).toBe(false);
    expect(r.recommendations).toEqual([]);
  });

  it('permission error → denied', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => { const e: any = new Error('Missing pos.booking.view'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.recommendAvailability(ctx as any, {});
    expect(r.denied).toBe(true);
  });
});

describe('detectConflict', () => {
  const args = { technicianId: 't1', startTime: '14:00', endTime: '14:45', date: '2026-07-10' };
  it('reports a conflict when the domain checker returns a conflicting appointment', async () => {
    const { s, booking } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => [], async () => ({ status: 'conflict', conflictingAppointmentId: 'appt_9' }));
    const r = await s.detectConflict(ctx as any, args);
    expect(booking.checkConflict).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), expect.objectContaining({ technicianId: 't1', startTime: '14:00' }));
    expect(r).toMatchObject({ hasConflict: true, conflictingAppointmentId: 'appt_9' });
  });
  it('reports no conflict when the slot is clear', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => [], async () => ({ status: 'ok' }));
    const r = await s.detectConflict(ctx as any, args);
    expect(r.hasConflict).toBe(false);
  });
  it('missing inputs or no branch → unavailable (no false "clear")', async () => {
    const { s } = svc(async () => ({ items: [] }));
    expect((await s.detectConflict(ctx as any, { technicianId: '', startTime: '', endTime: '' } as any)).unavailable).toBe(true);
    expect((await s.detectConflict({ ...ctx, branchId: null } as any, args)).unavailable).toBe(true);
  });
  it('permission error → denied', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => [], async () => { const e: any = new Error('Missing pos.booking.view'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.detectConflict(ctx as any, args);
    expect(r.denied).toBe(true);
  });
});

describe('recommendTechnicians', () => {
  const perTech = [
    { technicianId: 't1', name: 'Amy', slots: ['10:00', '11:00'] },
    { technicianId: 't2', name: 'Bea', slots: ['09:30', '10:30', '13:00'] },
    { technicianId: 't3', name: 'Cara', slots: [] },
  ];
  it('ranks by earliest availability, drops techs with no openings', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => perTech, async () => ({ status: 'ok' }));
    const r = await s.recommendTechnicians(ctx as any, { serviceIds: ['svc1'] });
    expect(r.available).toBe(true);
    expect(r.technicians.map((t) => t.name)).toEqual(['Bea', 'Amy']);      // Bea earliest (09:30); Cara dropped (0 slots)
    expect(r.technicians[0]).toMatchObject({ firstAvailable: '09:30', openSlots: 3 });
  });
  it('floats the customer\u2019s usual technician to the top', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => perTech, async () => ({ status: 'ok' }));
    const r = await s.recommendTechnicians(ctx as any, { preferredTechnicianName: 'Amy' });
    expect(r.technicians[0]).toMatchObject({ name: 'Amy', isUsual: true });
  });
  it('no branch → available:false', async () => {
    const { s } = svc(async () => ({ items: [] }));
    expect((await s.recommendTechnicians({ ...ctx, branchId: null } as any, {})).available).toBe(false);
  });
  it('permission error → denied', async () => {
    const { s } = svc(async () => ({ items: [] }), async () => [], async () => ({ items: [] }), async () => [], async () => { const e: any = new Error('Missing pos.booking.view'); e.name = 'ForbiddenError'; throw e; });
    expect((await s.recommendTechnicians(ctx as any, {})).denied).toBe(true);
  });
});

describe('draftMessage', () => {
  it('template fills real appointment details when the customer is matched', async () => {
    const item = { customerId: 'c1', displayName: 'Ann', fullName: 'Ann', phone: '+18565551234' };
    // TIME BOMB FIXED: this used to pin the appointment to '2026-07-11T14:00:00Z' — the day the test was written.
    // The copilot only surfaces UPCOMING appointments, so the test passed that morning and then failed every day
    // after 14:00 UTC, forever. Use a date that is always in the future and derive the expectation from it.
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);   // tomorrow, whenever "today" is
    const iso = startsAt.toISOString();
    const expected = `${iso.slice(0, 10)} at ${iso.slice(11, 16)}`;
    const appts = [{ startsAt: iso, serviceName: 'Gel Manicure', technicianName: 'Amy' }];
    const { s } = svc(async () => ({ items: [item] }), async () => appts);
    const r = await s.draftMessage(ctx as any, { kind: 'reminder', customerId: 'c1' });
    expect(r.matched).toBe(true);
    expect(r.body).toContain(expected);
    expect(r.body).toContain('Gel Manicure');
    expect(r.body).toContain('Amy');
  });
  it('unknown caller → generic greeting, no invented details', async () => {
    const body = draftMessageBody('reminder', null, null);
    expect(body.startsWith('Hi there,')).toBe(true);
    expect(body).not.toMatch(/\bon 20\d\d-/);   // no fabricated date
  });
  it('running_late needs no appointment', async () => {
    expect(draftMessageBody('running_late', 'Ann', null)).toContain('running a few minutes behind');
  });
});

describe('classifyIntent', () => {
  const cases: [string, string][] = [
    ['I need to cancel my appointment tomorrow', 'cancel_appointment'],
    ['can we reschedule her booking to Friday', 'reschedule_appointment'],
    ['book a gel manicure for Ann', 'book_appointment'],
    ['what times are available on Saturday', 'check_availability'],
    ['send her a reminder text', 'send_message'],
    ['look up who is calling from this number', 'customer_lookup'],
    ['how long is the wait in the queue', 'queue_status'],
  ];
  it.each(cases)('classifies %s → %s', (text, expected) => {
    expect(classifyIntent(text).intent).toBe(expected);
  });
  it('empty or unmatched text → general_question, low confidence', () => {
    expect(classifyIntent('').intent).toBe('general_question');
    expect(classifyIntent('nice weather today').intent).toBe('general_question');
    expect(classifyIntent('').confidence).toBe('low');
  });
  it('multiple cues raise confidence to high', () => {
    const r = classifyIntent('please cancel — she can\u2019t make it');
    expect(r.intent).toBe('cancel_appointment');
    expect(r.confidence).toBe('high');
  });
});

describe('cleanSmsDraft', () => {
  it('strips wrapping quotes and collapses whitespace', () => {
    expect(cleanSmsDraft('  "Hi Ann, see you soon"  ')).toBe('Hi Ann, see you soon');
    expect(cleanSmsDraft('a\n\n\nb')).toBe('a\nb');
  });
  it('returns null for empty and caps very long text', () => {
    expect(cleanSmsDraft('   ')).toBeNull();
    expect((cleanSmsDraft('x'.repeat(400)) || '').length).toBeLessThanOrEqual(320);
  });
});

describe('draftMessage LLM refinement (deterministic fallback)', () => {
  const customers = { context: async () => ({}) } as any;
  function svc(ai: any) { return new ReceptionCopilotContextService(customers, {} as any, {} as any, ai); }
  const ctx = { tenantId: 't', userId: 'u', role: 'M', permissions: [] } as any;

  it('keeps the deterministic draft when there is no AI service', async () => {
    const out = await svc(undefined).draftMessage(ctx, { kind: 'reminder' });
    expect(out.refined).toBe(false);
    expect(out.body).toContain('reminder');
  });
  it('keeps the deterministic draft when the provider is mock (no real key)', async () => {
    const ai = { run: async () => ({ ok: true, text: '[mock:mock-1] whatever', usage: { provider: 'mock', model: 'mock-1', inputTokens: 1, outputTokens: 1 } }) };
    const out = await svc(ai).draftMessage(ctx, { kind: 'reminder' });
    expect(out.refined).toBe(false);
  });
  it('uses the LLM text when a real provider responds', async () => {
    const ai = { run: async () => ({ ok: true, text: '"Hi! Friendly reminder about your visit — see you soon."', usage: { provider: 'openai', model: 'gpt-x', inputTokens: 10, outputTokens: 12 } }) };
    const out = await svc(ai).draftMessage(ctx, { kind: 'reminder' });
    expect(out.refined).toBe(true);
    expect(out.body).toBe('Hi! Friendly reminder about your visit — see you soon.');
  });
  it('falls back to deterministic when the provider errors', async () => {
    const ai = { run: async () => { throw new Error('ai_provider_error'); } };
    const out = await svc(ai).draftMessage(ctx, { kind: 'reminder' });
    expect(out.refined).toBe(false);
  });
});
