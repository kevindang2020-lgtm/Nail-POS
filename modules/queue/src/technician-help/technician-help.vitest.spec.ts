// technician-help.vitest.spec.ts — the Request-Help lifecycle: create (with backend eligibility gate), accept (which
// reassigns the service line to the helper — the mechanism that carries their per-line earnings), decline, guards,
// duplicate/race protection, tenant isolation, audit, and realtime notifications.
import { describe, it, expect, beforeEach } from 'vitest';
import { TechnicianHelpService, HelpError, type HelpEligibilityPort } from './technician-help.service';
import { InMemoryHelpRepository } from './technician-help.repository';

const primary = { tenantId: 't1', branchId: 'b1', technicianId: 'primary' };
const helper = { tenantId: 't1', branchId: 'b1', technicianId: 'helper' };

// helper is qualified for svc_full_set; nobody else / nothing else is.
const eligibility: HelpEligibilityPort = {
  isQualified: async (_t, _b, techId, serviceId) => techId === 'helper' && serviceId === 'svc_full_set',
  listQualified: async (_t, _b, serviceId) => serviceId === 'svc_full_set'
    ? [{ technicianId: 'helper', displayName: 'Helper', workingStatus: 'available', shiftStatus: 'on_shift', status: 'active' },
       { technicianId: 'primary', displayName: 'Primary', workingStatus: 'in_service', shiftStatus: 'on_shift', status: 'active' }]
    : [],
};

let repo: InMemoryHelpRepository;
let rtCalls: Array<[string, string, string]>;
let svc: TechnicianHelpService;

beforeEach(() => {
  repo = new InMemoryHelpRepository();
  repo.seedLine({ serviceLineId: 'L1', ticketId: 'TK1', serviceId: 'svc_full_set', technicianId: 'primary' });
  rtCalls = [];
  const rt = {
    toTechnician: (id: string, ev: string) => rtCalls.push(['tech', id, ev]),
    toTenant: (_c: any, ev: string) => rtCalls.push(['tenant', '', ev]),
  };
  svc = new TechnicianHelpService(repo, eligibility, rt);
});

const create = () => svc.createRequest(primary, { ticketId: 'TK1', serviceLineId: 'L1', helperTechnicianId: 'helper', reason: 'Need a second pair of hands' });
const code = async (fn: () => Promise<unknown>) => { try { await fn(); return 'NO_THROW'; } catch (e) { return e instanceof HelpError ? e.code : 'OTHER'; } };

describe('Request-Help lifecycle — create', () => {
  it('creates a pending request, audits it, and notifies the helper', async () => {
    const r = await create();
    expect(r.status).toBe('pending');
    expect(r.primaryTechnicianId).toBe('primary');
    expect(r.helperTechnicianId).toBe('helper');
    expect(repo.audits.some((a) => a.action === 'technician_help_requested')).toBe(true);
    expect(rtCalls.some(([t, id, ev]) => t === 'tech' && id === 'helper' && ev === 'technician_help_requested')).toBe(true);
  });
  it('rejects requesting help from yourself', async () => {
    expect(await code(() => svc.createRequest(primary, { ticketId: 'TK1', serviceLineId: 'L1', helperTechnicianId: 'primary', reason: 'x' }))).toBe('self_help');
  });
  it('rejects an unqualified helper (backend gate, not the client)', async () => {
    expect(await code(() => svc.createRequest(primary, { ticketId: 'TK1', serviceLineId: 'L1', helperTechnicianId: 'other', reason: 'x' }))).toBe('not_qualified');
  });
  it('rejects a closed ticket', async () => {
    repo.seedTicket('TK1', false);
    expect(await code(create)).toBe('ticket_closed');
  });
  it('rejects a line that is not on the ticket', async () => {
    expect(await code(() => svc.createRequest(primary, { ticketId: 'TK1', serviceLineId: 'NOPE', helperTechnicianId: 'helper', reason: 'x' }))).toBe('line_not_found');
  });
  it('rejects a missing reason', async () => {
    expect(await code(() => svc.createRequest(primary, { ticketId: 'TK1', serviceLineId: 'L1', helperTechnicianId: 'helper', reason: '   ' }))).toBe('reason_required');
  });
  it('rejects a duplicate open request for the same line + helper', async () => {
    await create();
    expect(await code(create)).toBe('duplicate_request');
  });
});

describe('Request-Help lifecycle — accept', () => {
  it('only the requested helper may accept', async () => {
    const r = await create();
    expect(await code(() => svc.accept(primary, r.id))).toBe('not_helper');
  });
  it('accept reassigns the service line to the helper (their earnings follow the line)', async () => {
    const r = await create();
    expect(repo.lineTechnician('L1')).toBe('primary');
    const out = await svc.accept(helper, r.id);
    expect(out.status).toBe('accepted');
    expect(repo.lineTechnician('L1')).toBe('helper');
    expect(repo.audits.some((a) => a.action === 'technician_help_accepted')).toBe(true);
    expect(rtCalls.some(([, , ev]) => ev === 'ticket_line_technician_assigned')).toBe(true);
  });
  it('a second accept is rejected (atomic transition — no double handling)', async () => {
    const r = await create();
    await svc.accept(helper, r.id);
    expect(await code(() => svc.accept(helper, r.id))).toBe('already_handled');
  });
});

describe('Request-Help lifecycle — decline', () => {
  it('helper declines with a reason; the primary is notified and the line is NOT reassigned', async () => {
    const r = await create();
    const out = await svc.decline(helper, r.id, 'Fully booked');
    expect(out.status).toBe('declined');
    expect(repo.lineTechnician('L1')).toBe('primary');
    expect(rtCalls.some(([t, id, ev]) => t === 'tech' && id === 'primary' && ev === 'technician_help_declined')).toBe(true);
    expect(repo.audits.some((a) => a.action === 'technician_help_declined')).toBe(true);
  });
  it('only the requested helper may decline', async () => {
    const r = await create();
    expect(await code(() => svc.decline(primary, r.id))).toBe('not_helper');
  });
});

describe('Request-Help lifecycle — listing + isolation', () => {
  it('lists a helper\'s pending requests', async () => {
    await create();
    const list = await svc.listForHelper(helper, ['pending']);
    expect(list.length).toBe(1);
    expect(list[0].helperTechnicianId).toBe('helper');
  });
  it('is tenant-isolated: another tenant cannot see or act on the request', async () => {
    const r = await create();
    const otherTenantHelper = { tenantId: 't2', branchId: 'b1', technicianId: 'helper' };
    expect(await svc.listForHelper(otherTenantHelper, ['pending'])).toEqual([]);
    expect(await code(() => svc.accept(otherTenantHelper, r.id))).toBe('not_found');
  });
});

describe('Request-Help — qualified helper picker (for the primary)', () => {
  it('lists qualified technicians for the line\'s service, excluding the requester', async () => {
    const picks = await svc.qualifiedForLine(primary, 'TK1', 'L1');
    expect(picks.map((p) => p.technicianId)).toEqual(['helper']);   // primary filtered out
  });
  it('returns empty for a line that is not on the ticket', async () => {
    expect(await svc.qualifiedForLine(primary, 'TK1', 'NOPE')).toEqual([]);
  });
});
