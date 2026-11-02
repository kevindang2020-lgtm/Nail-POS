// ai-customer-profile.vitest.spec.ts — Stage-1 coverage for the AI Customer Profile Assistant.
// (1) pure-core honest-counting invariants (§10/§11/§12/§14/§18/§21); (2) service permission gating (§7/§53);
// (3) tenant pass-through isolation — the AI layer forwards the trusted context unchanged and never widens scope (§5).
import { describe, it, expect } from 'vitest';
import {
  summarizeVisits, detectServicePreferences, detectTechnicianPreference, classifyInactivity,
  profileCompleteness, rebookingOpportunity, type VisitRecord, type AppointmentRecord,
} from './ai-customer-profile-core';
import { AiCustomerProfileService, AiCustomerProfileForbiddenError } from './ai-customer-profile.service';

const NOW = '2026-07-07T12:00:00.000Z';

function buildHistory() {
  const visits: VisitRecord[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.parse('2025-03-01') + i * 28 * 86400000).toISOString();
    const gel = i % 5 !== 0;
    visits.push({ date: d, serviceName: gel ? 'Gel Manicure' : 'Pedicure', technicianName: gel ? 'Amy' : 'Kim', requestedTechnician: gel && i > 3, totalCents: 5000, tipCents: 800 });
  }
  const appts: AppointmentRecord[] = [
    ...visits.map(v => ({ startsAt: v.date, serviceName: v.serviceName, technicianName: v.technicianName, status: 'completed' })),
    { startsAt: '2025-05-10T10:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Amy', status: 'cancelled' },
    { startsAt: '2025-06-02T10:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Amy', status: 'no_show' },
    { startsAt: '2026-07-18T10:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Amy', status: 'booked' },
  ];
  return { visits, appts };
}

describe('ai-customer-profile core — honest counting', () => {
  const { visits, appts } = buildHistory();

  it('§10 counts only completed service records; canceled/no-show never count as visits', () => {
    const vs = summarizeVisits(visits, appts, NOW, 2);
    expect(vs.completedVisits).toBe(14);
    expect(vs.canceledCount).toBe(1);
    expect(vs.noShowCount).toBe(1);
    expect(vs.upcomingCount).toBe(1);
    expect(vs.nextAppointment).toContain('2026-07-18');
  });

  it('§11 a single visit is never a preference', () => {
    expect(detectServicePreferences([visits[0]], NOW)[0].confidence).toBe('insufficient');
    expect(detectServicePreferences(visits, NOW)[0].serviceName).toBe('Gel Manicure');
  });

  it('§12 technician preference reaches "confirmed" only when repeatedly requested', () => {
    const assigned = detectTechnicianPreference(visits.map(v => ({ ...v, requestedTechnician: false })))!;
    expect(assigned.confidence).not.toBe('confirmed');
  });

  it('§14 a future appointment overrides inactivity; new customers are insufficient_history', () => {
    expect(classifyInactivity('2026-01-01T00:00:00Z', 28, true, 14, NOW).status).toBe('active');
    expect(classifyInactivity('2026-06-01T00:00:00Z', null, false, 1, NOW).status).toBe('insufficient_history');
  });

  it('§18 completeness measures data quality only and flags invalid contact info', () => {
    const c = profileCompleteness({ firstName: 'Jen', lastName: 'Lee', phone: '8565551234', email: 'nope', smsConsentKnown: true });
    expect(c.invalid).toContain('email format');
  });

  it('§21/§22 rebooking is suppressed by a future appointment or do-not-contact', () => {
    const inact = classifyInactivity('2026-03-01T00:00:00Z', 28, false, 14, NOW);
    expect(rebookingOpportunity(inact, false, false, 28).eligible).toBe(true);
    expect(rebookingOpportunity(inact, true, false, 28).eligible).toBe(false);
    expect(rebookingOpportunity(inact, false, true, 28).eligible).toBe(false);
  });
});

// Minimal fake CustomersService that (a) asserts it receives the caller's tenant context and (b) returns per-tenant data.
function fakeCustomers(recorded: { tenantId?: string }) {
  const dataByTenant: Record<string, any> = {
    'tenant-A': { detail: { displayName: 'Alice A', status: 'active', email: 'a@a.com' }, visits: buildHistory().visits, appointments: buildHistory().appts },
    'tenant-B': { detail: { displayName: 'Bob B', status: 'active', email: 'b@b.com' }, visits: [], appointments: [] },
  };
  return {
    detail: async (ctx: any) => { recorded.tenantId = ctx.tenantId; return dataByTenant[ctx.tenantId]?.detail ?? null; },
    visits: async (ctx: any) => dataByTenant[ctx.tenantId]?.visits ?? [],
    appointments: async (ctx: any) => dataByTenant[ctx.tenantId]?.appointments ?? [],
    duplicates: async () => [],
  } as any;
}

describe('ai-customer-profile service — permission + tenant isolation', () => {
  it('§7/§53 denies callers lacking the view capability', async () => {
    const svc = new AiCustomerProfileService(fakeCustomers({}));
    const ctx = { tenantId: 'tenant-A', branchId: '', userId: 'u1', role: 'TECHNICIAN', permissions: [] };
    await expect(svc.visitSummary(ctx as any, 'c1')).rejects.toBeInstanceOf(AiCustomerProfileForbiddenError);
  });

  it('§5 forwards the trusted tenant context unchanged and never crosses tenants', async () => {
    const rec: { tenantId?: string } = {};
    const svc = new AiCustomerProfileService(fakeCustomers(rec));
    const ctxA = { tenantId: 'tenant-A', branchId: '', userId: 'u1', role: 'OWNER', permissions: ['customers.view'] };
    const a = await svc.overview(ctxA as any, 'c1');
    expect(rec.tenantId).toBe('tenant-A');
    expect(a.displayName).toBe('Alice A');
    expect(a.completedVisits).toBe(14);

    const ctxB = { tenantId: 'tenant-B', branchId: '', userId: 'u2', role: 'OWNER', permissions: ['customers.view'] };
    const b = await svc.overview(ctxB as any, 'c1');
    expect(rec.tenantId).toBe('tenant-B');       // scope moved to B, not leaked from A
    expect(b.displayName).toBe('Bob B');
    expect(b.completedVisits).toBe(0);           // B has zero history; A's 14 never bleed in
  });
});

// ============================ STAGE 2 ============================
import {
  evaluateChurnRisk, recommendServices, type VisitRecord as VR,
} from './ai-customer-profile-core';
import { ProfileCache } from './ai-customer-profile.cache';

describe('ai-customer-profile core — churn & recommendations (stage 2)', () => {
  it('§15/§33 churn is a range, never a certainty; one cancellation is not churn; min-data guarded', () => {
    expect(evaluateChurnRisk({ completedVisits: 2, daysSinceLastVisit: 200, typicalIntervalDays: null, hasFutureAppointment: false, canceledCount: 0, noShowCount: 0, membershipCanceled: false, unresolvedFollowUp: false }).level).toBe('insufficient');
    expect(evaluateChurnRisk({ completedVisits: 10, daysSinceLastVisit: 120, typicalIntervalDays: 28, hasFutureAppointment: true, canceledCount: 0, noShowCount: 0, membershipCanceled: false, unresolvedFollowUp: false }).level).toBe('low');
    const one = evaluateChurnRisk({ completedVisits: 10, daysSinceLastVisit: 20, typicalIntervalDays: 28, hasFutureAppointment: false, canceledCount: 1, noShowCount: 0, membershipCanceled: false, unresolvedFollowUp: false });
    expect(['low', 'possible']).toContain(one.level);
    const hi = evaluateChurnRisk({ completedVisits: 12, daysSinceLastVisit: 130, typicalIntervalDays: 28, hasFutureAppointment: false, canceledCount: 3, noShowCount: 2, membershipCanceled: true, unresolvedFollowUp: true });
    expect(hi.level).toBe('high');
    expect(hi.note).toMatch(/not a confirmed decision/i);
  });

  it('§19 never recommends an inactive service; degrades without catalog permission', () => {
    const visits: VR[] = [];
    for (let i = 0; i < 8; i++) visits.push({ date: new Date(Date.parse('2025-06-01') + i * 28 * 86400000).toISOString(), serviceName: i < 6 ? 'Gel Manicure' : 'Pedicure', technicianName: 'Amy', totalCents: 5000, tipCents: 800 });
    const recs = recommendServices(visits, new Set(['Gel Manicure']), '2026-07-07T12:00:00Z');
    expect(recs.some(r => r.serviceName === 'Pedicure')).toBe(false);
    expect(recs.some(r => r.serviceName === 'Gel Manicure' && r.availabilityConfirmed)).toBe(true);
    const noCat = recommendServices(visits, null, '2026-07-07T12:00:00Z');
    expect(noCat.every(r => r.availabilityConfirmed === false)).toBe(true);
  });
});

describe('ai-customer-profile cache — tenant & permission isolation (§38)', () => {
  it('isolates by tenant and permission fingerprint, and invalidates per-tenant', async () => {
    const c = new ProfileCache();
    const A: any = { tenantId: 'A', branchId: '', userId: 'u', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] };
    const B: any = { tenantId: 'B', branchId: '', userId: 'u', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] };
    const low: any = { tenantId: 'A', branchId: '', userId: 'u2', role: 'RECEPTIONIST', permissions: ['customers.view'] };
    await c.set(A, 'cust1', 'overview', { secret: 'A' });
    expect(await c.get(B, 'cust1', 'overview')).toBeNull();       // cross-tenant blocked
    expect((await c.get<any>(A, 'cust1', 'overview'))?.secret).toBe('A');
    expect(await c.get(low, 'cust1', 'overview')).toBeNull();     // lower-permission user misses owner-scoped key
    await c.invalidateTenant('A');
    expect(await c.get(A, 'cust1', 'overview')).toBeNull();
  });
});

describe('ai-customer-profile service — churn is manage-gated (§49)', () => {
  it('denies churn to a view-only caller, allows a manage-capable caller', async () => {
    const fake = { ...fakeCustomers({}), getMembership: async () => ({ status: 'active' }) } as any;
    const svc = new AiCustomerProfileService(fake);
    const viewOnly: any = { tenantId: 'tenant-A', branchId: '', userId: 'u', role: 'RECEPTIONIST', permissions: ['customers.view'] };
    await expect(svc.churnRisk(viewOnly, 'c1')).rejects.toBeInstanceOf(AiCustomerProfileForbiddenError);
    const manager: any = { tenantId: 'tenant-A', branchId: '', userId: 'u', role: 'MANAGER', permissions: ['customers.view', 'customers.edit'] };
    const res = await svc.churnRisk(manager, 'c1');
    expect(res.level).toBeDefined();
    expect(res.note).toMatch(/not a confirmed decision/i);
  });
});

// ============================ STAGE 3 ============================
import { hasPermission } from '@aipowersalon/permissions';

class MergeForbidden extends Error { constructor(m: string) { super(m); this.name = 'ForbiddenError'; } }

function fakeCustomersWithMerge(state: { mergeCalled: boolean }) {
  const group = { duplicateGroupId: 'g1', reason: 'same phone', members: [
    { customerId: 'c1', displayName: 'Jen Lee', phone: '111', email: 'a@a.com' },
    { customerId: 'c2', displayName: 'Jenn Lee', phone: '111', email: 'b@b.com' },
  ] };
  const visits = Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.parse('2025-06-01') + i * 28 * 86400000).toISOString(), serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 }));
  return {
    detail: async () => ({ displayName: 'Jen Lee', status: 'active', email: 'a@a.com' }),
    visits: async () => visits,
    appointments: async () => [],
    getMembership: async () => ({ status: 'active' }),
    duplicates: async () => [group],
    merge: async (ctx: any, _g: string, pid: string) => {
      if (!hasPermission(ctx, 'pos.customers.merge')) throw new MergeForbidden('Missing pos.customers.merge');
      state.mergeCalled = true; return { customerId: pid, merged: true };
    },
  } as any;
}

describe('ai-customer-profile service — duplicate merge is confirmed, permissioned, and invalidates cache (§16/§38)', () => {
  const merger: any = { tenantId: 'A', branchId: '', userId: 'u', role: 'OWNER', permissions: ['customers.view', 'customers.edit', 'customers.merge'] };
  const viewer: any = { tenantId: 'A', branchId: '', userId: 'u', role: 'RECEPTIONIST', permissions: ['customers.view'] };

  it('preview is read-only and never merges', async () => {
    const state = { mergeCalled: false };
    const svc = new AiCustomerProfileService(fakeCustomersWithMerge(state));
    const prev: any = await svc.mergePreview(viewer, 'g1', 'c1');
    expect(prev.survivingRecord.customerId).toBe('c1');
    expect(prev.confirmationRequired).toBe(true);
    expect(state.mergeCalled).toBe(false);
  });

  it('rejects merge without explicit confirmation (no auto-merge)', async () => {
    const state = { mergeCalled: false };
    const svc = new AiCustomerProfileService(fakeCustomersWithMerge(state));
    await expect(svc.merge(merger, 'g1', 'c1', false)).rejects.toThrow(/DUPLICATE_REVIEW_REQUIRED/);
    expect(state.mergeCalled).toBe(false);
  });

  it('forbids merge to a caller lacking pos.customers.merge', async () => {
    const state = { mergeCalled: false };
    const svc = new AiCustomerProfileService(fakeCustomersWithMerge(state));
    await expect(svc.merge(viewer, 'g1', 'c1', true)).rejects.toHaveProperty('name', 'ForbiddenError');
    expect(state.mergeCalled).toBe(false);
  });

  it('executes on confirm + permission and invalidates the tenant cache', async () => {
    const state = { mergeCalled: false };
    const svc = new AiCustomerProfileService(fakeCustomersWithMerge(state));
    await (svc as any).cache.set(merger, 'cust', 'overview', { x: 1 });
    const res: any = await svc.merge(merger, 'g1', 'c1', true);
    expect(state.mergeCalled).toBe(true);
    expect(res.invalidatedCache).toBe(true);
    expect(await (svc as any).cache.get(merger, 'cust', 'overview')).toBeNull();
  });

  it('§25 copilot context is honest about the un-wired call summary', async () => {
    const svc = new AiCustomerProfileService(fakeCustomersWithMerge({ mergeCalled: false }));
    const cc: any = await svc.copilotContext(viewer, 'c1');
    expect(cc.callSummaryConnected).toBe(false);
    expect(cc.recentCall).toBeNull();
    expect(cc.overview).toBeDefined();
  });
});

// ============================ SETTINGS / FEATURE GATE (§52/§64/§65) ============================
import { AiCustomerProfileService as SvcS, type ProfileSettingsPort } from './ai-customer-profile.service';
import { resolveSettings, PLATFORM_DEFAULTS } from './ai-customer-profile-settings';

const visitsN = (n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse('2025-03-01') + i * 28 * 86400000).toISOString(), serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 }));
const fakeCust: any = { detail: async () => ({ displayName: 'Jen', status: 'active' }), visits: async () => visitsN(8), appointments: async () => [], getMembership: async () => ({ status: 'active' }), duplicates: async () => [] };
const gctx = (perms = ['customers.view', 'customers.edit']): any => ({ tenantId: 'A', branchId: 'b1', userId: 'u', role: 'OWNER', permissions: perms });

describe('ai-customer-profile settings resolution (pure)', () => {
  it('disabled-wins and records the level', () => {
    const r = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { enabled: false } });
    expect(r.enabled).toBe(false); expect(r.disabledAtLevel).toBe('tenant');
  });
  it('clamps nonsensical overrides and lets later layers win', () => {
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { tunables: { inactiveDays: -5 as any } } }).tunables.inactiveDays).toBe(90);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { tunables: { inactiveDays: 30 } }, branch: { tunables: { inactiveDays: 14 } } }).tunables.inactiveDays).toBe(14);
  });
});

describe('ai-customer-profile feature gate + emergency disable', () => {
  const off = (level: 'tenant' | 'branch'): ProfileSettingsPort => ({ async layers() { return { [level]: { enabled: false } } as any; } });
  it('disabled at tenant or branch throws AI_CUSTOMER_PROFILE_DISABLED for reads', async () => {
    const st = new SvcS(fakeCust, undefined, undefined, null, off('tenant'));
    await expect(st.overview(gctx(), 'c1')).rejects.toThrow('AI_CUSTOMER_PROFILE_DISABLED');
    const sb = new SvcS(fakeCust, undefined, undefined, null, off('branch'));
    await expect(sb.visitSummary(gctx(), 'c1')).rejects.toThrow('AI_CUSTOMER_PROFILE_DISABLED');
  });
  it('still exposes effective settings (with the disabled level) so the UI can explain it', async () => {
    const st = new SvcS(fakeCust, undefined, undefined, null, off('tenant'));
    const eff = await st.getEffectiveSettings(gctx());
    expect(eff.enabled).toBe(false); expect(eff.disabledAtLevel).toBe('tenant');
  });
  it('per-tenant tunable override flows into confidence scoring', async () => {
    const strict: ProfileSettingsPort = { async layers() { return { tenant: { tunables: { minVisitsForServicePref: 99 } } }; } };
    const s = new SvcS(fakeCust, undefined, undefined, null, strict);
    expect((await s.servicePreferences(gctx(), 'c1')).preferences[0].confidence).not.toBe('high');
  });
});

// ============================ CUSTOMER TIMELINE (§23) ============================
import { buildTimeline as buildTL, type VisitRecord as VRt, type AppointmentRecord as ARt } from './ai-customer-profile-core';

describe('ai-customer-profile timeline (pure)', () => {
  const NOW = '2026-07-07T12:00:00.000Z';
  const visits: VRt[] = Array.from({ length: 10 }, (_, i) => ({ date: new Date(Date.parse('2025-06-01') + i * 20 * 86400000).toISOString(), serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 }));
  const appts: ARt[] = [
    ...visits.map(v => ({ startsAt: v.date, serviceName: 'Gel', technicianName: 'Amy', status: 'completed' })),
    { startsAt: '2025-05-01T10:00:00Z', serviceName: 'Gel', technicianName: 'Amy', status: 'cancelled' },
    { startsAt: '2025-05-15T10:00:00Z', serviceName: 'Pedi', technicianName: 'Kim', status: 'no_show' },
    { startsAt: '2026-08-01T10:00:00Z', serviceName: 'Gel', technicianName: 'Amy', status: 'booked' },
  ];

  it('is newest-first, bounded, and cursor-paginated', () => {
    const p1 = buildTL(visits, appts, NOW, { limit: 5 });
    expect(p1.events.length).toBe(5);
    expect(Date.parse(p1.events[0].at)).toBeGreaterThanOrEqual(Date.parse(p1.events[4].at));
    expect(p1.hasMore).toBe(true);
    const p2 = buildTL(visits, appts, NOW, { limit: 5, before: p1.nextCursor });
    expect(p2.events.every(e => Date.parse(e.at) < Date.parse(p1.nextCursor!))).toBe(true);
  });
  it('does not double-count completed appointments and clamps the limit', () => {
    const all = buildTL(visits, appts, NOW, { limit: 9999 });
    expect(all.events.length).toBeLessThanOrEqual(100);
    expect(all.events.some(e => e.type === 'appointment_booked' && e.at.startsWith('2025-06'))).toBe(false);
    expect(all.events.some(e => e.type === 'appointment_cancelled')).toBe(true);
    expect(all.events.some(e => e.type === 'appointment_no_show')).toBe(true);
  });
});

// ============================ SETTINGS PERSISTENCE (§52/§65) ============================
import { rowsToLayers as r2l, resolveSettings as resolve2, PLATFORM_DEFAULTS as PD2, type SettingsRow as SR } from './ai-customer-profile-settings';
import { AiCustomerProfileService as SvcP, DefaultProfileSettings as DPS, type ProfileSettingsPort as PSP } from './ai-customer-profile.service';

describe('ai-customer-profile settings persistence mapping (pure)', () => {
  it('applies only rows matching the current branch/user', () => {
    const rows: SR[] = [
      { level: 'tenant', branch_id: null, user_id: null, enabled: true, tunables: { inactiveDays: 45 } },
      { level: 'branch', branch_id: 'b1', user_id: null, enabled: false, tunables: null },
      { level: 'branch', branch_id: 'bZ', user_id: null, enabled: false, tunables: null },
      { level: 'user', branch_id: null, user_id: 'u1', enabled: null, tunables: { minVisitsForCadence: 5 } },
    ];
    const layers = r2l(rows, { branchId: 'b1', userId: 'u1' });
    expect(layers.tenant?.tunables?.inactiveDays).toBe(45);
    expect(layers.branch?.enabled).toBe(false);
    expect(layers.user?.enabled).toBeUndefined();
    expect(resolve2({ platform: PD2, ...layers }).disabledAtLevel).toBe('branch');
  });
});

describe('ai-customer-profile updateSettings', () => {
  const cust: any = { detail: async () => ({ displayName: 'X', status: 'active' }), visits: async () => [], appointments: async () => [], getMembership: async () => ({ status: 'active' }), duplicates: async () => [] };
  const mgr: any = { tenantId: 'A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] };

  it('persists via the port, invalidates cache, and a persisted disable blocks reads', async () => {
    const store: any = {};
    const port: PSP = { async layers() { return store.tenant ? { tenant: store.tenant } : {}; }, async setLayer(_c, lvl, patch) { store[lvl] = patch; } };
    const svc = new SvcP(cust, undefined, undefined, null, port);
    await (svc as any).cache.set(mgr, 'c', 'overview', { x: 1 });
    await svc.updateSettings(mgr, 'tenant', { enabled: false });
    expect(store.tenant.enabled).toBe(false);
    expect(await (svc as any).cache.get(mgr, 'c', 'overview')).toBeNull();
    await expect(svc.overview(mgr, 'c')).rejects.toThrow('AI_CUSTOMER_PROFILE_DISABLED');
  });
  it('rejects updates on the non-persistent default port', async () => {
    const svc = new SvcP(cust, undefined, undefined, null, new DPS());
    await expect(svc.updateSettings(mgr, 'tenant', { enabled: false })).rejects.toThrow('SETTINGS_NOT_PERSISTED');
  });
});

// ============================ USAGE METERING (§58) ============================
import { InMemoryProfileMetrics as IPM } from './ai-customer-profile.metrics';
import { AiCustomerProfileService as SvcM, AiCustomerProfileForbiddenError as FbM } from './ai-customer-profile.service';

describe('ai-customer-profile usage metering', () => {
  const cust: any = { detail: async () => ({ displayName: 'X', status: 'active' }), visits: async () => Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.parse('2025-03-01') + i * 28 * 86400000).toISOString(), serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 })), appointments: async () => [], getMembership: async () => ({ status: 'active' }), duplicates: async () => [] };
  const A = (perms = ['customers.view', 'customers.edit']): any => ({ tenantId: 'A', branchId: 'b1', userId: 'u', role: 'OWNER', permissions: perms });
  const B = (): any => ({ tenantId: 'B', branchId: 'b1', userId: 'u', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] });

  it('counts usage per tenant, records denials, and is manage-gated', async () => {
    const metrics = new IPM();
    const svc = new SvcM(cust, undefined, undefined, null, undefined, metrics);
    await svc.overview(A(), 'c1');
    await svc.churnRisk(A(), 'c1');
    try { await svc.churnRisk(A(['customers.view']), 'c1'); } catch { /* denied */ }
    await svc.overview(B(), 'c1');

    const uA: any = (await svc.getUsage(A())).usage;
    expect(uA.summaries_generated).toBeGreaterThanOrEqual(1);
    expect(uA.churn_evaluations).toBeGreaterThanOrEqual(1);
    expect(uA.permission_denied).toBeGreaterThanOrEqual(1);
    const uB: any = (await svc.getUsage(B())).usage;
    expect(uB.permission_denied ?? 0).toBe(0); // tenant B untouched by A's denial
    await expect(svc.getUsage(A(['customers.view']))).rejects.toBeInstanceOf(FbM);
  });
});

// ============================ TENANT AGGREGATE SCAN (§44) ============================
import { aggregateTenant as aggT, type TenantScanItem as TSI } from './ai-customer-profile-core';
import { AiCustomerProfileService as SvcA } from './ai-customer-profile.service';

describe('ai-customer-profile tenant aggregate (pure + service)', () => {
  const NOW = '2026-07-07T12:00:00.000Z';
  const vis = (dates: string[]) => dates.map(d => ({ date: d, serviceName: 'Gel', technicianName: 'Amy', totalCents: 5000, tipCents: 800 }));
  const H = {
    active: { visits: vis(['2026-06-20']), appointments: [{ startsAt: '2026-07-20', serviceName: 'Gel', technicianName: 'Amy', status: 'booked' }] },
    inactive: { visits: vis(['2025-01-01', '2025-02-01', '2025-03-01']), appointments: [] },
    newbie: { visits: vis(['2026-06-01']), appointments: [] },
  };

  it('buckets customers correctly and never double-counts', () => {
    const agg = aggT([H.active, H.inactive, H.newbie] as TSI[], NOW);
    expect(agg.totalScanned).toBe(3);
    expect(agg.active).toBe(1);
    expect(agg.withUpcomingAppointment).toBe(1);
    expect(agg.insufficientHistory).toBe(1);
    expect(agg.inactive + agg.longTermInactive + agg.dueForReturn).toBeGreaterThanOrEqual(1);
  });

  it('refreshTenantOverview scans the directory (bounded) and caches the aggregate', async () => {
    const byId: any = { c1: H.active, c2: H.inactive, c3: H.newbie };
    const customers: any = {
      list: async () => ({ items: [{ customerId: 'c1' }, { customerId: 'c2' }, { customerId: 'c3' }] }),
      visits: async (_c: any, id: string) => byId[id].visits,
      appointments: async (_c: any, id: string) => byId[id].appointments,
      duplicates: async () => [{ duplicateGroupId: 'g1', reason: 'x', members: [] }],
    };
    const svc = new SvcA(customers);
    const ctx: any = { tenantId: 'A', branchId: '', userId: 'u', role: 'OWNER', permissions: ['customers.view'] };
    const r: any = await svc.refreshTenantOverview(ctx);
    expect(r.totalScanned).toBe(3);
    expect(r.duplicateCandidateGroups).toBe(1);
    expect((await svc.tenantOverview(ctx)).totalScanned).toBe(3);
  });
});

// ============================ SCAN SCHEDULER ORCHESTRATION (§39/§40/§41) ============================
import { runTenantScan as runScan, buildSystemScanContext as sysCtx } from './ai-customer-profile.scan';

describe('ai-customer-profile scan orchestration', () => {
  it('the system scan context is tenant-scoped, view-only, and branch-agnostic', () => {
    const c = sysCtx('T1');
    expect(c.tenantId).toBe('T1');
    expect(c.branchId).toBe('');
    expect(c.permissions).toEqual(['customers.view']);
  });
  it('isolates per-tenant failures and enforces the per-tick cap', async () => {
    const scanned: string[] = [];
    const r = await runScan(['a', 'bad', 'b', 'c'], async (id) => { if (id === 'bad') throw new Error('AI_CUSTOMER_PROFILE_DISABLED'); scanned.push(id); });
    expect(r.attempted).toBe(4);
    expect(r.succeeded).toBe(3);
    expect(r.failed).toBe(1);
    expect(scanned).toEqual(['a', 'b', 'c']); // failure didn't stop the batch
    expect(r.failures[0].tenantId).toBe('bad');

    const many = Array.from({ length: 500 }, (_, i) => 't' + i);
    const r2 = await runScan(many, async () => {}, { cap: 200 });
    expect(r2.attempted).toBe(200);
  });
});

// ============================ CALL SUMMARY (§24/§25) ============================
import { summarizeCalls as sumCalls, type CallRow as CR } from './ai-customer-profile-core';
import { AiCustomerProfileService as SvcC, DefaultCallSummary as DCS, type CallSummaryPort as CSP } from './ai-customer-profile.service';

describe('ai-customer-profile call summary', () => {
  const rows: CR[] = [
    { startedAt: '2026-06-01T10:00:00Z', direction: 'inbound', aiHandled: true, intent: 'book', outcome: 'recovered', durationSeconds: 90, recoveredAppointmentId: 'appt1' },
    { startedAt: '2026-07-01T10:00:00Z', direction: 'inbound', aiHandled: false, intent: 'reschedule', outcome: 'answered', durationSeconds: 120 },
  ];
  const cust: any = { detail: async () => ({ displayName: 'X', status: 'active' }), visits: async () => [], appointments: async () => [], getMembership: async () => ({ status: 'active' }), duplicates: async () => [] };
  const ctx: any = { tenantId: 'A', branchId: '', userId: 'u', role: 'OWNER', permissions: ['customers.view'] };

  it('pure: NotConnected when empty; newest-first with no transcript field', () => {
    expect(sumCalls([]).connected).toBe(false);
    const s = sumCalls(rows);
    expect(s.lastCall!.at).toBe('2026-07-01T10:00:00Z');
    expect(s.totalCalls).toBe(2);
    expect(s.aiHandledCalls).toBe(1);
    expect('transcript' in (s.lastCall as any)).toBe(false);
  });

  it('service surfaces verified calls in copilotContext, tenant-scoped, honest NotConnected on default port', async () => {
    const port: CSP = { async customerCalls(c, id) { return c.tenantId === 'A' && id === 'c1' ? rows : []; } };
    const svc = new SvcC(cust, undefined, undefined, null, undefined, undefined, port);
    const cop: any = await svc.copilotContext(ctx, 'c1');
    expect(cop.callSummaryConnected).toBe(true);
    expect(cop.recentCall.at).toBe('2026-07-01T10:00:00Z');
    expect((await svc.callSummary({ ...ctx, tenantId: 'B' }, 'c1')).connected).toBe(false); // isolation

    const svc2 = new SvcC(cust, undefined, undefined, null, undefined, undefined, new DCS());
    expect((await svc2.copilotContext(ctx, 'c1')).callSummaryConnected).toBe(false);
  });
});

// ============================ BRANCH PREFERENCE (§13) ============================
import { detectBranchPreference as branchPref } from './ai-customer-profile-core';

describe('ai-customer-profile branch preference (§13)', () => {
  it('uses the saved preferred branch (confirmed) and is honest when unavailable', () => {
    const saved = branchPref('Marlton');
    expect(saved.source).toBe('saved');
    expect(saved.confidence).toBe('confirmed');
    expect(saved.visitInferenceAvailable).toBe(false); // visit-based inference needs a read-model branch field

    const none = branchPref(null);
    expect(none.source).toBe('none');
    expect(none.confidence).toBe('insufficient');
    expect(none.evidence[0]).toMatch(/not available/);
  });
  it('infers from visit branches when that data becomes available', () => {
    const inferred = branchPref(null, ['A', 'A', 'A', 'B']);
    expect(inferred.source).toBe('visit_history');
    expect(inferred.preferredBranch).toBe('A');
    expect(inferred.visitInferenceAvailable).toBe(true);
  });
});

// ============================ CROSS-INSTANCE USAGE METERING (§58) ============================
import { RedisProfileMetrics as RPM, FakeMetricsRedis as FMR } from './ai-customer-profile.metrics';

describe('ai-customer-profile Redis metrics sink (cross-instance)', () => {
  it('aggregates counts from multiple nodes into one tenant-scoped truth', async () => {
    const shared = new FMR();
    const nodeA = new RPM(shared, { prefix: 't:' });
    const nodeB = new RPM(shared, { prefix: 't:' });
    nodeA.incr('T1', 'summaries_generated');
    nodeA.incr('T1', 'summaries_generated');
    nodeB.incr('T1', 'summaries_generated');
    nodeB.incr('T2', 'churn_evaluations');
    await new Promise((r) => setTimeout(r, 5));
    expect((await nodeA.snapshot('T1')).summaries_generated).toBe(3); // A+B aggregated
    expect((await nodeB.snapshot('T1')).summaries_generated).toBe(3);
    expect((await nodeA.snapshot('T2')).churn_evaluations).toBe(1);   // tenant-isolated
    expect((await nodeA.snapshot('T2')).summaries_generated).toBeUndefined();
    expect(Object.keys(await nodeA.snapshot('T9')).length).toBe(0);
  });
});

import { duplicateConfidence, allSame } from './ai-customer-profile-core';
describe('ai-customer-profile core — duplicate confidence never counts a blank as a match (Duplicate Review guide §04, Nov 2 2026)', () => {
  it('the screenshot case: two "test" records, one phone, no emails → possible (was strong)', () => {
    const m = [{ phone: null, email: null, displayName: 'test' }, { phone: '+16095550001', email: null, displayName: 'test' }];
    expect(allSame(m.map((x) => x.phone))).toBe(false);
    expect(duplicateConfidence('Similar name', allSame(m.map((x) => x.phone)), allSame(m.map((x) => x.email)), allSame(m.map((x) => x.displayName)))).toBe('possible');
  });
  it('a shared family phone with different names is possible; phone + name is strong; phone + email + name is exact', () => {
    expect(duplicateConfidence('Same phone', true, false, false)).toBe('possible');
    expect(duplicateConfidence('Same phone', true, false, true)).toBe('strong');
    expect(duplicateConfidence('Same phone', true, true, true)).toBe('exact');
    expect(allSame(['Amy  Lee', 'amy lee'])).toBe(true);
  });
});

import { AiCustomerProfileController } from './ai-customer-profile.controller';
describe('ai-customer-profile — retired tenant-overview routes (Customer Intelligence guide, Nov 2 2026)', () => {
  it('GET tenant-overview and POST tenant-overview/refresh stay retired (the dashboard reads /pos/customer-intelligence/*)', () => {
    for (const h of ['tenantOverview', 'refreshTenantOverview']) expect((AiCustomerProfileController.prototype as any)[h]).toBeUndefined();
  });
});
