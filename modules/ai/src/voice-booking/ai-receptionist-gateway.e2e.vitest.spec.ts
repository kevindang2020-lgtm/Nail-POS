// ai-receptionist-gateway.e2e.vitest.spec.ts — §33 end-to-end Retell simulation. Unlike the unit spec (which mocks
// manage/write), this composes the gateway controller over the REAL service graph exactly as the module wires it:
// AiReceptionistGatewayController → VoiceBookingService → CustomerBookingService (real availability math)
//                                 → VoiceBookingWriteService / VoiceManageService → BookingService (real conflict
//                                   detection, store-hours rules, status machine) → InMemoryBookingRepository
//                                 → CustomersService → InMemoryCustomersRepository
// The availability data port wraps the SAME booking repository instance the write path mutates, so booking a slot
// makes it disappear from availability — the loop is real, not staged. Seed day: tenant luxe001 on 2026-06-06
// (repo TODAY), technician Mia busy 10:00–11:00 and 13:00–13:45.
// Exit-criteria coverage (spec §42): 1,3,4,5,7,8,9,10*,11,12,13 (*handoff asserts the honest callback fallback here;
// the branch-phone transfer path is unit-tested). True same-instant concurrency is proven at the DB layer (migration
// 301 real-PG test); here the second competitor runs after the first commits, exercising the BUSINESS conflict rule.
import { BookingService, InMemoryBookingRepository, type BookingContext, CustomerBookingService, type CustomerBookingDataPort } from '@aipowersalon/booking';
import { CustomersService, InMemoryCustomersRepository } from '@aipowersalon/customers';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AiReceptionistGatewayController } from './ai-receptionist-gateway.controller';
import { VoiceBookingService, type VoiceContext } from './voice-booking.service';
import { VoiceBookingWriteService } from './voice-booking-write.service';
import { VoiceManageService } from './voice-manage.service';
import { VoiceIdempotencyService, InMemoryVoiceIdempotencyRepo, VoiceBranchInfoService } from './voice-idempotency.service';
import { VoiceCallOutcomeService, InMemoryCallOutcomeRepo } from './voice-call-outcome.service';
import { AiFollowUpService, InMemoryFollowUpRepo } from './ai-follow-up.service';

const T = 'luxe001', B = 'b1', DATE = '2026-06-06'; // the in-memory repo's seeded TODAY
const V: VoiceContext = { tenantId: T, branchId: B };
// Constitution 12 M12: a real call carries the number it comes FROM, set by the voice platform's server-side
// integration. The e2e caller calls from the number on file, as a genuine customer would.
const req = (ctx: VoiceContext = V, callerNumber: string = CALLER) => ({ voiceCtx: ctx, headers: { 'x-voice-caller-number': callerNumber } });
const CALLER = '8565552020';   // the customer on file (PHONE below) — calling from their own number
const readCtx: BookingContext = { tenantId: T, branchId: B, userId: 'e2e', role: 'OWNER', permissions: ['pos.booking.view'] };
const fail = async (p: Promise<any>) => { try { await p; return null; } catch (e: any) { return e?.getResponse?.() ?? e; } };

// One repository instance shared by BOTH the write path and the availability port — state is genuinely shared.
const bookingRepo = new InMemoryBookingRepository();
const port: CustomerBookingDataPort = {
  resolveCustomerId: async () => ({ id: 'e2e_caller', fullName: 'E2E Caller' }),
  listServices: async (c: any) => (await bookingRepo.serviceCatalog({ ...readCtx, tenantId: c.tenantId })).map((s) => ({ id: s.serviceId, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents })),
  getService: async (c: any, id: string) => { const s = (await bookingRepo.serviceCatalog({ ...readCtx, tenantId: c.tenantId })).find((x) => x.serviceId === id); return s ? { id: s.serviceId, name: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents } : null; },
  listTechnicians: async (c: any) => (await bookingRepo.technicians({ ...readCtx, tenantId: c.tenantId })).filter((t) => t.available !== false).map((t) => ({ id: t.technicianId, fullName: t.name })),
  getTechnician: async (c: any, id: string) => { const t = (await bookingRepo.technicians({ ...readCtx, tenantId: c.tenantId })).find((x) => x.technicianId === id); return t ? { id: t.technicianId, fullName: t.name } : null; },
  existingForDate: async (c: any, date: string) => (await bookingRepo.existingForConflict({ ...readCtx, tenantId: c.tenantId }, date)).map((a) => ({ appointmentId: a.appointmentId, technicianId: a.technicianId ?? '', startTime: a.startTime, endTime: a.endTime, status: a.status })),
  insertBooking: async () => { throw new Error('e2e: gateway must not write via the customer-booking port'); },
  insertBookingAtomic: async () => { throw new Error('e2e: gateway must not write via the customer-booking port'); },
} as any;

const booking = new BookingService(bookingRepo);
const customers = new CustomersService(new InMemoryCustomersRepository());
const gatewayRead = new VoiceBookingService(new CustomerBookingService(port));
const write = new VoiceBookingWriteService(booking);
const manage = new VoiceManageService(booking, customers);
const idem = new VoiceIdempotencyService(new InMemoryVoiceIdempotencyRepo());
const branchInfo = new VoiceBranchInfoService(null); // no DB handle → honest callback fallback for handoff
const outcomes = new VoiceCallOutcomeService(new InMemoryCallOutcomeRepo());
const followUps = new AiFollowUpService(new InMemoryFollowUpRepo());
const c = new AiReceptionistGatewayController(gatewayRead as any, write, manage, idem, branchInfo, outcomes, followUps);

const PHONE = '8565552020';
let customerId = '';
let appointmentId = '';

beforeAll(() => { process.env.VOICE_WRITE_TOOLS_ENABLED = 'true'; });
afterAll(() => { delete process.env.VOICE_WRITE_TOOLS_ENABLED; });

describe('E2E flow A — new booking (get_services → check_availability → lookup_or_create_customer → book → get)', () => {
  let slot16: any;

  it('§42.1: returns the actual salon services (integer cents)', async () => {
    const out: any = await c.services(req());
    const mani = out.data.services.find((s: any) => s.name === 'Signature Manicure');
    expect(mani).toBeTruthy();
    expect(mani.durationMinutes).toBe(45);
    expect(mani.priceCents).toBe(5500);
  });

  it('§42.3: real availability excludes Mia\u2019s existing 10:00 appointment and offers 16:00', async () => {
    const out: any = await c.availability(req(), 'svc_mani', DATE, 'tech_mia');
    const starts = out.data.slots.map((s: any) => s.displayTime);
    expect(starts).not.toContain('10:00');                 // she's genuinely busy (seeded bk_5101)
    slot16 = out.data.slots.find((s: any) => s.displayTime === '16:00');
    expect(slot16).toBeTruthy();                            // clearly clear of her seeded bookings + buffer
  });

  it('buffer-aware: the gateway does NOT offer 11:00 (the 5-min booking buffer after her 10:00\u201311:00 appointment)', async () => {
    // The raw customer-booking grid is buffer-unaware and would offer 11:00; the gateway re-verifies each slot
    // against BookingService.checkConflict (the same rule create() uses), so a slot create() would reject is filtered.
    const raw = await gatewayRead.availability(V, { serviceId: 'svc_mani', date: DATE, technicianId: 'tech_mia' });
    const rawHas11 = raw.some((s: any) => s.startTime === '11:00');
    const out: any = await c.availability(req(), 'svc_mani', DATE, 'tech_mia');
    const offered11 = out.data.slots.some((s: any) => s.displayTime === '11:00');
    expect(offered11).toBe(false);                          // filtered by the authoritative buffer check
    if (rawHas11) expect(rawHas11 && !offered11).toBe(true); // and it WAS in the raw grid — the filter did the work
  });

  it('§42.4: creates a real tenant-scoped customer — only with consent', async () => {
    const noConsent: any = await fail(c.lookupOrCreateCustomer(req(), { phone: PHONE, firstName: 'Kevin', lastName: 'Test' }, 'fn_cust_0'));
    expect(noConsent.error.code).toBe('CUSTOMER_CONSENT_REQUIRED');
    const out: any = await c.lookupOrCreateCustomer(req(), { phone: PHONE, firstName: 'Kevin', lastName: 'Test', consent: true }, 'fn_cust_1');
    expect(out.data).toMatchObject({ created: true, matchType: 'CREATED' });
    customerId = out.data.customer.id;
    const again: any = await c.lookupOrCreateCustomer(req(), { phone: PHONE }, 'fn_cust_2');
    expect(again.data).toMatchObject({ created: false, matchType: 'PHONE_EXACT' }); // dedupe: same person found, not duplicated
    expect(again.data.customer.id).toBe(customerId);
  });

  it('§42.5 + §42.11: books the real appointment; a duplicate Retell call does NOT create a second one', async () => {
    const body = { serviceId: 'svc_mani', date: DATE, startTime: '16:00', technicianId: 'tech_mia', customerId, callerConfirmed: true };
    const out: any = await c.book(req(), body, 'fn_book_1');
    expect(out.success).toBe(true);
    appointmentId = out.data.appointment.id;
    expect(out.data.appointment.startAt).toBe(`${DATE}T16:00:00-04:00`); // June in New York = EDT
    const dup: any = await c.book(req(), body, 'fn_book_1');             // Retell retry, same Idempotency-Key
    expect(dup.meta.idempotentReplay).toBe(true);
    expect(dup.data.appointment.id).toBe(appointmentId);
    const rows = await bookingRepo.existingForConflict(readCtx, DATE);
    expect(rows.filter((r) => r.technicianId === 'tech_mia' && r.startTime === '16:00').length).toBe(1); // exactly one
  });

  it('§42.6-equivalent: the appointment is now visible to the existing booking layer — and gone from availability', async () => {
    const detail = await booking.detail(readCtx, appointmentId);         // the same detail the Booking screen reads
    expect(detail?.startTime).toBe('16:00');
    const out: any = await c.availability(req(), 'svc_mani', DATE, 'tech_mia');
    expect(out.data.slots.map((s: any) => s.displayTime)).not.toContain('16:00'); // real shared state
  });

  it('§42.7: retrieves the created appointment — verified caller only, masked phone', async () => {
    const unverified: any = await fail(c.getAppointment(req(), appointmentId, '9995550000'));
    expect(unverified.error.code).toBe('CALLER_VERIFICATION_REQUIRED');
    // Constitution 12 M12: the RIGHT spoken number from the WRONG line is refused — end to end through the gateway.
    const impostor: any = await fail(c.getAppointment(req(V, '2125559999'), appointmentId, PHONE));
    expect(impostor.error.code).toBe('CALLER_VERIFICATION_REQUIRED');
    const out: any = await c.getAppointment(req(), appointmentId, PHONE);
    expect(out.data.appointment).toMatchObject({ id: appointmentId, canReschedule: true, canCancel: true });
    expect(out.data.appointment.customer.phoneMasked).toBe('***-***-2020');
  });
});

describe('E2E — two callers competing for one exclusive slot (§42.13, business rule via the REAL conflict engine)', () => {
  it('the first booking wins; the second gets SLOT_UNAVAILABLE from BookingService conflict detection', async () => {
    const at17 = (n: number) => ({ serviceId: 'svc_mani', date: DATE, startTime: '17:00', technicianId: 'tech_mia', customerName: `Rival ${n}`, customerPhone: `856555300${n}`, callerConfirmed: true });
    const win: any = await c.book(req(), at17(1), 'fn_race_1');
    expect(win.success).toBe(true);
    const lose: any = await fail(c.book(req(), at17(2), 'fn_race_2'));
    expect(lose.error.code).toBe('SLOT_UNAVAILABLE');
    expect(lose.error.suggestedAction).toBe('CHECK_AVAILABILITY');
    const rows = await bookingRepo.existingForConflict(readCtx, DATE);
    expect(rows.filter((r) => r.technicianId === 'tech_mia' && r.startTime === '17:00').length).toBe(1);
  });
});

describe('E2E flow B — reschedule (get → check_availability → reschedule → get)', () => {
  it('§42.8: moves the verified caller\u2019s own appointment atomically to a free slot', async () => {
    const avail: any = await c.availability(req(), 'svc_mani', DATE, 'tech_mia');
    expect(avail.data.slots.map((s: any) => s.displayTime)).toContain('18:00'); // Mia is free after 13:45
    const out: any = await c.reschedule(req(), appointmentId, { phone: PHONE, date: DATE, startTime: '18:00', callerConfirmed: true }, 'fn_resch_1');
    expect(out.success).toBe(true);
    const after: any = await c.getAppointment(req(), appointmentId, PHONE);
    expect(after.data.appointment.startTime).toBe('18:00');
    const rows = await bookingRepo.existingForConflict(readCtx, DATE);
    expect(rows.filter((r) => r.appointmentId === appointmentId).length).toBe(1); // moved, not duplicated
  });
});

describe('E2E flow C — cancel (get → cancel → get; repeated cancel is safe)', () => {
  it('§42.9 + §42.11: cancels once; the retried call replays instead of re-running; history preserved', async () => {
    const out: any = await c.cancel(req(), appointmentId, { phone: PHONE, callerConfirmed: true, reason: 'CUSTOMER_REQUEST' }, 'fn_cxl_1');
    expect(out.data.appointment.status).toBe('CANCELED');
    const dup: any = await c.cancel(req(), appointmentId, { phone: PHONE, callerConfirmed: true, reason: 'CUSTOMER_REQUEST' }, 'fn_cxl_1');
    expect(dup.meta.idempotentReplay).toBe(true);
    const detail = await booking.detail(readCtx, appointmentId);
    expect(detail?.status).toBe('cancelled');               // record kept, status model used — not deleted
    const after: any = await c.getAppointment(req(), appointmentId, PHONE);
    expect(after.data.appointment).toMatchObject({ canReschedule: false, canCancel: false });
  });
});

describe('E2E flow D — handoff + cross-tenant isolation', () => {
  it('§42.10: handoff answers honestly (no configured destination here → callback, never a fabricated number)', async () => {
    const out: any = await c.handoff(req(), { reason: 'CUSTOMER_REQUESTED_HUMAN', summary: 'Wants custom design pricing.', callId: 'call_e2e_1' }, 'fn_hand_1');
    expect(out.data.handoff).toMatchObject({ accepted: true, transferEnabled: false, callbackRequested: true });
    expect(out.data.handoff.transferDestination).toBeUndefined();
  });

  it('§42.12: a second tenant\u2019s key cannot read the first tenant\u2019s appointment', async () => {
    const V2: VoiceContext = { tenantId: 'other01', branchId: 'b9' };
    const made: any = await c.lookupOrCreateCustomer(req(V2), { phone: '2015550001', firstName: 'Other', consent: true }, 'fn_t2_cust');
    expect(made.data.created).toBe(true);                   // verified caller exists in tenant 2
    const out: any = await fail(c.getAppointment(req(V2, '2015550001'), appointmentId, '2015550001'));   // verified in tenant 2, calling from their own number
    expect(out.error.code).toBe('APPOINTMENT_NOT_FOUND');   // tenant-scoped detail: it simply does not exist for them
  });
});
