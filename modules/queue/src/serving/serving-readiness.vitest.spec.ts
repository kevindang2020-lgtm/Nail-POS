import { describe, it, expect } from 'vitest';
import { TechnicianEligibilityService, InMemoryEligibilityReader, type TechnicianEligibilityRecord } from '@aipowersalon/workforce';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { serviceDoneReadiness, DEFAULT_SERVING_SETTINGS } from './serving.dto';

// extras Serving 05 — "why a Visit is or is not ready for Service Done": THE gates (canMarkDone / canSendToServiceDone) and
// the person's permissions, returned on the ticket detail; read only.
const ctx = (permissions: string[]): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'MANAGER', permissions } as ServingContext);
const VIEW = 'pos.serving.view';
const SEND = ['pos.serving.send_to_service_done', 'pos.service_done.view'];
const MARK = 'pos.serving.mark_done';

describe('serviceDoneReadiness (pure)', () => {
  const base = { settings: DEFAULT_SERVING_SETTINGS, lines: [{ status: 'done' }, { status: 'serving' }, { status: 'assigned' }], canMarkReady: true, canSend: true };
  it('states each case and never counts done lines as open', () => {
    expect(serviceDoneReadiness({ ...base, status: 'in_service' })).toEqual({ state: 'ready', reasons: [], openServiceLines: 2, via: 'send_to_service_done' });
    expect(serviceDoneReadiness({ ...base, status: 'in_service', canSend: false })).toMatchObject({ state: 'ready', via: 'mark_ready' });
    expect(serviceDoneReadiness({ ...base, status: 'not_started' })).toMatchObject({ state: 'not_ready', reasons: ['NOT_STARTED'] });
    expect(serviceDoneReadiness({ ...base, status: 'sent_to_service_done' })).toMatchObject({ state: 'handed_off', reasons: [] });
    expect(serviceDoneReadiness({ ...base, status: 'completed', canSend: false })).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect(serviceDoneReadiness({ ...base, status: 'paused', canSend: false, canMarkReady: false })).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect(serviceDoneReadiness({ ...base, status: 'delayed', canSend: false, notes: '  ', settings: { ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true } })).toMatchObject({ state: 'not_ready', reasons: ['NOTES_REQUIRED'] });
    expect(serviceDoneReadiness({ ...base, status: 'delayed', canSend: false, notes: 'ok', settings: { ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true } })).toMatchObject({ state: 'ready', via: 'mark_ready' });
  });
});

describe('GET serving ticket detail carries serviceDoneReadiness that agrees with the real transitions', () => {
  it('send holder: ready via send; after the send the visit reads handed_off', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    const d = await svc.detail(ctx([VIEW, ...SEND]), 'sv_4001');
    expect(d.serviceDoneReadiness).toMatchObject({ state: 'ready', via: 'send_to_service_done' });
    expect(d.serviceDoneReadiness!.openServiceLines).toBe(d.services.filter((l) => l.status !== 'done').length);
    await svc.sendToServiceDone(ctx([VIEW, ...SEND]), 'sv_4001');
    expect((await svc.detail(ctx([VIEW, ...SEND]), 'sv_4001')).serviceDoneReadiness).toMatchObject({ state: 'handed_off' });
  });

  it('notes rule: NOTES_REQUIRED is shown exactly when Mark Ready refuses for it', async () => {
    const repo = new InMemoryServingRepository();
    repo.settings = async () => ({ ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true });
    const svc = new ServingService(repo);
    const c = ctx([VIEW, MARK]);
    const d = await svc.detail(c, 'sv_4005');
    expect(d.serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NOTES_REQUIRED'] });
    await expect(svc.markDone(c, 'sv_4005')).rejects.toThrow(/NOTES_REQUIRED/);
  });

  it('view-only: not ready — no permission; a guest not started: NOT_STARTED; reading moves nothing', async () => {
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo);
    expect((await svc.detail(ctx([VIEW]), 'sv_4001')).serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NO_PERMISSION'] });
    expect((await svc.detail(ctx([VIEW, ...SEND]), 'sv_4003')).serviceDoneReadiness).toMatchObject({ state: 'not_ready', reasons: ['NOT_STARTED'] });
    expect((await svc.detail(ctx([VIEW]), 'sv_4001')).status).toBe('in_service');
    expect(await repo.serviceDoneLock(ctx([VIEW]), 'sv_4001')).toBeNull();
  });
});

// extras Serving 05 (round 10) — qualified availability: the OTHER free technicians THE eligibility authority would accept
// for this visit's services; refused / busy technicians are left out; without the authority it is null (never guessed).
describe('GET serving ticket detail carries qualifiedAvailability from THE eligibility authority', () => {
  const rec = (id: string, name: string, over: Partial<TechnicianEligibilityRecord> = {}): TechnicianEligibilityRecord =>
    ({ technicianId: id, fullName: name, employment: 'ACTIVE', rosterBranchId: 'br_cherryhill', branchIds: ['br_cherryhill'], approvedServiceIds: ['svc_mani', 'svc_gel', 'svc_pedi'], certifications: [], ...over } as TechnicianEligibilityRecord);
  const svcs = { svc_mani: { name: 'Signature Manicure', requiredCertification: null }, svc_gel: { name: 'Gel Add-on', requiredCertification: null, isAddOn: true, categoryName: 'Add-on' }, svc_pedi: { name: 'Spa Pedicure', requiredCertification: null } };
  it('lists the free, qualified others; an unapproved one and a not-free one are left out; reading assigns nothing', async () => {
    // sv_4001 = Mia (primary) · manicure + gel. Ava is free but not approved for manicure; Leo is qualified but not free.
    const reader = new InMemoryEligibilityReader({ tech_mia: rec('tech_mia', 'Mia'), tech_ava: rec('tech_ava', 'Ava', { approvedServiceIds: ['svc_pedi'] }), tech_leo: rec('tech_leo', 'Leo') }, svcs);
    const repo = new InMemoryServingRepository(); const svc = new ServingService(repo, undefined, undefined, new TechnicianEligibilityService({ reader }));
    const d = await svc.detail(ctx([VIEW]), 'sv_4001');
    expect(d.qualifiedAvailability).toEqual({ technicians: [], checked: 1 });   // only Ava is free (Mia is the primary, Leo is busy) — and she is not approved
    // sv_4002 = Ava (primary) · pedicure → Mia is free and approved for pedicure
    expect((await svc.detail(ctx([VIEW]), 'sv_4002')).qualifiedAvailability).toEqual({ technicians: [{ technicianId: 'tech_mia', name: 'Mia' }], checked: 1 });
    // sv_4003 = Leo (primary) · manicure → Mia qualifies, Ava does not
    expect((await svc.detail(ctx([VIEW]), 'sv_4003')).qualifiedAvailability).toEqual({ technicians: [{ technicianId: 'tech_mia', name: 'Mia' }], checked: 2 });
    expect((await repo.ticket(ctx([VIEW]), 'sv_4003'))!.primaryTechId).toBe('tech_leo');
  });
  it('no eligibility authority → null (unknown), not an empty list', async () => {
    expect((await new ServingService(new InMemoryServingRepository()).detail(ctx([VIEW]), 'sv_4001')).qualifiedAvailability).toBeNull();
  });
});
