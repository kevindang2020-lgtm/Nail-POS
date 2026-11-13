import { describe, it, expect } from 'vitest';
import { TechnicianEligibilityService, InMemoryEligibilityReader, type TechnicianEligibilityRecord } from '@aipowersalon/workforce';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { DEFAULT_SERVING_SETTINGS } from './serving.dto';

// extras Serving 07 — Touch Safe Action Review: before Mark Ready / a move / an add-on (catalog or manual price) the screen
// shows the guest, the lines touched, the permission and every conflict — and each blocking conflict is EXACTLY the refusal
// the real action answers (same gates). Read only.
const ctx = (permissions: string[]): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'MANAGER', permissions } as ServingContext);
const VIEW = 'pos.serving.view';
const ALL = [VIEW, 'pos.serving.mark_done', 'pos.serving.assign_technician', 'pos.serving.edit_services'];
const rec = (id: string, name: string, over: Partial<TechnicianEligibilityRecord> = {}): TechnicianEligibilityRecord =>
  ({ technicianId: id, fullName: name, employment: 'ACTIVE', rosterBranchId: 'br_cherryhill', branchIds: ['br_cherryhill'], approvedServiceIds: ['svc_mani', 'svc_gel', 'svc_pedi', 'svc_art'], certifications: [], ...over } as TechnicianEligibilityRecord);

describe('Serving 07 action review', () => {
  it('Mark Ready: guest, every line, the permission, open lines as a warning; reading moves nothing', async () => {
    const repo = new InMemoryServingRepository(); const svc = new ServingService(repo);
    const r = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'mark_ready' });
    expect(r.guest).toEqual({ customerName: 'Grace Kim', ticketNumber: '#3041', isVip: true });
    expect(r.affected.map((a) => [a.serviceName, a.priceCents])).toEqual([['Signature Manicure', 5500], ['Gel Add-on', 1500]]);
    expect(r.permission).toEqual({ key: 'pos.serving.mark_done', allowed: true });
    expect(r.conflicts).toEqual([{ code: 'OPEN_SERVICE_LINES', severity: 'info', vars: { n: 2 } }]);
    expect(r.canProceed).toBe(true);
    expect(r.needsConfirmation).toBe(false);   // a clean Mark Ready stays one tap
    expect((await repo.ticket(ctx(ALL), 'sv_4001'))!.status).toBe('in_service');
    expect(await repo.listRevisions(ctx(ALL), 'sv_4001')).toEqual([]);
  });

  it('Mark Ready blocked exactly when markDone refuses: not started, notes required; no permission → cannot proceed', async () => {
    const repo = new InMemoryServingRepository();
    repo.settings = async () => ({ ...DEFAULT_SERVING_SETTINGS, requireNotesBeforeDone: true });
    const svc = new ServingService(repo);
    const notStarted = await svc.actionReview(ctx(ALL), 'sv_4003', { action: 'mark_ready' });
    expect(notStarted.conflicts[0]).toEqual({ code: 'NOT_IN_SERVICE', severity: 'block' });
    await expect(svc.markDone(ctx(ALL), 'sv_4003')).rejects.toThrow(/NOT_IN_SERVICE/);
    const notes = await svc.actionReview(ctx(ALL), 'sv_4005', { action: 'mark_ready' });
    expect(notes.conflicts.find((c) => c.severity === 'block')?.code).toBe('NOTES_REQUIRED');
    expect(notes.canProceed).toBe(false); expect(notes.needsConfirmation).toBe(true);
    await expect(svc.markDone(ctx(ALL), 'sv_4005')).rejects.toThrow(/NOTES_REQUIRED/);
    const viewer = await new ServingService(new InMemoryServingRepository()).actionReview(ctx([VIEW]), 'sv_4001', { action: 'mark_ready' });
    expect(viewer.permission.allowed).toBe(false); expect(viewer.canProceed).toBe(false);
  });

  it('Move technician: from → to, the primary technician lines, eligibility refusal as a block and same technician as a warning', async () => {
    const reader = new InMemoryEligibilityReader({ tech_mia: rec('tech_mia', 'Mia'), tech_ava: rec('tech_ava', 'Ava', { approvedServiceIds: ['svc_pedi'] }), tech_leo: rec('tech_leo', 'Leo') },
      { svc_mani: { name: 'Signature Manicure', requiredCertification: null }, svc_gel: { name: 'Gel Add-on', requiredCertification: null, isAddOn: true, categoryName: 'Add-on' }, svc_pedi: { name: 'Spa Pedicure', requiredCertification: null } });
    const repo = new InMemoryServingRepository(); const svc = new ServingService(repo, undefined, undefined, new TechnicianEligibilityService({ reader }));
    const ok = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'assign_technician', technicianId: 'tech_leo' });
    expect(ok.change).toEqual({ fromTechnicianName: 'Mia', toTechnicianName: 'Leo' });
    expect(ok.affected).toHaveLength(2);
    expect(ok.conflicts).toEqual([]); expect(ok.canProceed).toBe(true); expect(ok.needsConfirmation).toBe(true);
    const unskilled = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'assign_technician', technicianId: 'tech_ava' });
    expect(unskilled.conflicts).toEqual([{ code: 'TECHNICIAN_NOT_SKILLED', severity: 'block', vars: { service: 'Signature Manicure' } }]);
    expect(unskilled.canProceed).toBe(false);
    await expect(svc.assignTechnician(ctx(ALL), 'sv_4001', { technicianId: 'tech_ava' })).rejects.toThrow(/not currently approved/);
    const same = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'assign_technician', technicianId: 'tech_mia' });
    expect(same.conflicts).toEqual([{ code: 'SAME_TECHNICIAN', severity: 'warn' }]);
    const ghost = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'assign_technician', technicianId: 'tech_nobody' });
    expect(ghost.conflicts[0]).toEqual({ code: 'TECHNICIAN_NOT_FOUND', severity: 'block' });
    expect((await repo.ticket(ctx(ALL), 'sv_4001'))!.primaryTechId).toBe('tech_mia');
  });

  it('Add-on: catalog price, duplicates warned; a manual price blocks without the override authority (as addService refuses) and warns with it', async () => {
    const repo = new InMemoryServingRepository(); const svc = new ServingService(repo);
    const r = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'add_service', serviceId: 'svc_art' });
    expect(r.affected).toEqual([{ serviceLineId: null, serviceName: 'Nail Art', technicianName: 'Mia', priceCents: 2000, isNew: true }]);
    expect(r.change).toEqual({ catalogPriceCents: 2000, priceCents: 2000, priceSource: 'catalog' });
    expect(r.conflicts).toEqual([]); expect(r.canProceed).toBe(true);
    expect((await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'add_service', serviceId: 'svc_gel' })).conflicts).toEqual([{ code: 'ALREADY_ON_TICKET', severity: 'warn', vars: { service: 'Gel Add-on' } }]);
    const manual = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'add_service', serviceId: 'svc_art', priceCents: '1000' });
    expect(manual.conflicts).toEqual([{ code: 'PRICE_OVERRIDE_NOT_PERMITTED', severity: 'block' }]);
    expect(manual.change?.priceSource).toBe('manual');
    await expect(svc.addService(ctx(ALL), 'sv_4001', { serviceId: 'svc_art', priceOverrideCents: 1000 })).rejects.toThrow(/Price override not permitted/);
    const mgr = await svc.actionReview(ctx([...ALL, 'pos.booking.override_conflict']), 'sv_4001', { action: 'add_service', serviceId: 'svc_art', priceCents: 1000 });
    expect(mgr.conflicts).toEqual([{ code: 'MANUAL_PRICE', severity: 'warn', vars: { catalogCents: 2000, priceCents: 1000 } }]);
    expect(mgr.canProceed).toBe(true);
    await expect(svc.actionReview(ctx(ALL), 'sv_4001', { action: 'add_service', serviceId: 'svc_art', priceCents: '12.5' })).rejects.toThrow(/whole cents/);
    expect((await repo.ticket(ctx(ALL), 'sv_4001'))!.lines).toHaveLength(2);
  });

  it('a technician booked sooner than this visit still needs is a BOOKING_SOON warning; the Service Done lock blocks edits', async () => {
    const repo = new InMemoryServingRepository();
    repo.nextBookingMinutes = async () => ({ tech_leo: 10 });
    const svc = new ServingService(repo);
    const r = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'assign_technician', technicianId: 'tech_leo' });
    expect(r.conflicts).toEqual([{ code: 'BOOKING_SOON', severity: 'warn', vars: { name: 'Leo', minutes: 10, needs: 25 } }]);
    await repo.lockServiceDone(ctx(ALL), 'sv_4001', 'u1', 7000);
    const locked = await svc.actionReview(ctx(ALL), 'sv_4001', { action: 'add_service', serviceId: 'svc_art' });
    expect(locked.conflicts[0]).toEqual({ code: 'TICKET_LOCKED_AT_SERVICE_DONE', severity: 'block' });
    await expect(svc.actionReview(ctx(ALL), 'sv_4001', { action: 'refund' })).rejects.toThrow(/Unknown action/);
  });
});
