// POSAISchedulingOptimizerScreen.test.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer → complete). Goes through the
// REAL api client with a routed fetch (like the Phase 6 queue screen), so a wrong path, verb, query or body fails here.
// The backend is written concurrently — the routes / bodies below are contract §2–§3 exactly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen, waitFor, fireEvent, act, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { REALTIME_EVENT } from '../realtime/realtime-client';

const perms = { deny: new Set<string>() };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER' } }) }));

import { POSAISchedulingOptimizerScreen } from './POSAISchedulingOptimizerScreen';

type Call = { url: string; method: string; body?: any };
type Reply = { status?: number; body?: any; raw?: string };
const B = '/pos/ai-scheduling-optimizer';
const metrics = (o: any = {}) => ({ idleMin: 90, waitMin: 12, utilizationPct: 71, gapCount: 3, latenessRiskPct: 8, ...o });
const versions = { forecastVersion: null, ruleVersion: 'r7', engineVersion: 'e2', configVersion: 4 };
export const rec = (o: any = {}) => ({
  id: 'r1', branchId: 'b1', runId: null, type: 'move_appointment', status: 'review_required',
  currentState: { appointmentId: 'a1', date: '2026-10-08', startTime: '10:00', endTime: '10:45', technicianId: 't1', status: 'confirmed', version: 3, customerId: 'c1' },
  proposedState: { kind: 'reschedule', appointmentId: 'a1', date: '2026-10-08', startTime: '11:15', endTime: '12:00', technicianId: 't2' },
  affectedAppointmentIds: ['a1'], affectedTechnicianIds: ['t1', 't2'], hardConstraintsChecked: true, violations: [],
  simulation: { before: metrics(), after: metrics({ idleMin: 60, utilizationPct: 78, gapCount: 2 }), deltas: { idleSavedMin: 30, waitSavedMin: 0, utilizationGainPct: 7, gapsRemoved: 1, latenessReducedPct: 0 }, improved: true },
  expectedBenefit: ['Closes a 30 min gap for Leo'], possibleDownside: ['The customer moves 75 minutes later'],
  confidence: 0.82, dataQuality: 'good', touchesConfirmedAppointment: true, requiresCustomerApproval: true,
  versions, version: 5, applyAttempt: 0, automated: false, expiresAt: '2026-10-08T16:00:00Z',
  explanation: null, explanationSource: null, proposal: null, decidedByUserId: null, decidedAt: null, appliedAt: null,
  createdAt: '2026-10-08T14:00:00Z', updatedAt: '2026-10-08T14:00:00Z', ...o,
});
const run = (o: any = {}) => ({ id: 'run1', branchId: 'b1', scope: 'branch_day', status: 'completed', date: '2026-10-08', technicianId: null, trigger: 'job', metrics: metrics(), recommendationCount: 2, gapCount: 3, conflictCount: 1, versions, latencyMs: 140, errorCode: null, startedAt: '2026-10-08T13:00:00Z', completedAt: '2026-10-08T13:00:01Z', ...o });
const settingsView = (o: any = {}) => ({
  effective: { enabled: true, killed: false, platformKilled: false, automationAllowed: false, config: { automationEnabled: false, allowedAutoActions: ['add_internal_warning'], confidenceThreshold: 0.85, weights: { preferredTimeProximity: 1, waitReduction: 1, gapFit: 1, preferencePreservation: 1, utilization: 1, fragmentation: 1, overtimeAvoidance: 1, workloadBalance: 1, idleReduction: 1 }, gapMinServiceMin: 30, largeBlockMin: 90, utilizationTargetPct: 80, bookingIntervalMin: 15, minLeadTimeMin: 60, maxHorizonDays: 14, humanReviewRequired: true, recommendationTtlMin: 30, proposalTtlHours: 24 } },
  tenant: null, branch: { level: 'branch', branchId: 'b1', enabled: null, killSwitch: null, config: { gapMinServiceMin: 25 }, version: 6, updatedAt: '2026-10-07T10:00:00Z', updatedByUserId: 'u1' }, ...o,
});
const server: { r1: any } = { r1: null };
const defaults = (): Record<string, Reply | ((c: Call) => Reply)> => ({
  [`GET ${B}/settings`]: { body: settingsView() },
  [`PUT ${B}/settings`]: { body: settingsView() },
  [`GET ${B}/settings/versions`]: { body: [{ version: 6, level: 'branch', branchId: 'b1', enabled: null, killSwitch: null, config: { gapMinServiceMin: 25 }, changedByUserId: 'u1', createdAt: '2026-10-07T10:00:00Z' }] },
  [`GET ${B}/runs`]: { body: [run()] },
  [`POST ${B}/runs`]: { body: { run: run({ trigger: 'manual' }), gaps: [{}, {}], conflicts: [], recommendations: [rec()] } },
  [`GET ${B}/runs/run1`]: { body: { run: run(), gaps: [{ id: 'g1', technicianId: 't2', date: '2026-10-08', startTime: '13:00', endTime: '13:45', durationMin: 45, cause: 'cancellation', servicesThatFit: ['Gel Manicure'] }], conflicts: [{ id: 'c1', type: 'double_booking', severity: 'critical', appointmentIds: ['a1', 'a2'], technicianId: 't1', date: '2026-10-08', message: 'Mia has two guests at 10:00', resolved: false }], recommendations: [rec()] } },
  [`GET ${B}/recommendations`]: (c) => ({ body: c.url.includes('status=customer_approval_required') ? { items: [rec({ id: 'r3', status: 'customer_approval_required', proposal: { id: 'p1', status: 'customer_notified', customerId: 'c1', proposedDate: '2026-10-08', proposedStartTime: '11:15', proposedTechnicianId: 't2', originalDate: '2026-10-08', originalStartTime: '10:00', originalTechnicianId: 't1', notifiedAt: '2026-10-08T14:05:00Z', decidedAt: null, decisionChannel: null, expiresAt: '2026-10-09T14:05:00Z' } })], total: 1 }
    : c.url.includes('status=customer_approved') || c.url.includes('status=application_failed') ? { items: [], total: 0 }
      : { items: [rec(), rec({ id: 'r2', type: 'fill_gap', status: 'applied', requiresCustomerApproval: false, automated: true })], total: 2 } }),
  // the server's current r1 — decisions change it, so the reload after an action sees the new state (as the real API does)
  [`GET ${B}/recommendations/r1`]: () => ({ body: { recommendation: server.r1 } }),
  [`POST ${B}/recommendations/r1/accept`]: (c) => { server.r1 = rec({ status: 'customer_approval_required', version: c.body.expectedVersion + 2 }); return { body: { recommendation: server.r1 } }; },
  [`POST ${B}/recommendations/r1/reject`]: (c) => ({ body: { recommendation: rec({ status: 'rejected', version: c.body.expectedVersion + 2 }) } }),
  [`POST ${B}/recommendations/r1/explain`]: () => { server.r1 = rec({ explanation: 'Moving Jane to 11:15 fills Leo’s gap.', explanationSource: 'template' }); return { body: { recommendation: server.r1 } }; },
  [`POST ${B}/recommendations/r3/customer-decision`]: { body: { recommendation: rec({ id: 'r3', status: 'customer_approved' }) } },
  [`POST ${B}/recommendations/generate`]: { status: 422, body: { code: 'HARD_CONSTRAINT_VIOLATION', message: 'violates', violations: [{ code: 'MISSING_SKILL', message: 'Leo does not do acrylic' }] } },
  [`POST ${B}/options`]: (c) => ({ body: { options: [{ id: 't2@2026-10-08T11:00', technicianId: 't2', technicianName: 'Leo', date: '2026-10-08', startTime: '11:00', endTime: '12:15', score: 0.91, breakdown: {}, blocks: [{ serviceId: 's1', startTime: '11:00', endTime: '11:45' }, { serviceId: 's2', startTime: '11:45', endTime: '12:15' }], reasons: ['no wait'], fallback: false }], forecastAvailable: false, hold: c.body.hold ? { holdId: 'h1', optionId: 't2@2026-10-08T11:00', expiresAt: '2026-10-08T15:10:00Z' } : null } }),
  [`POST ${B}/holds/h1/release`]: { body: { ok: true } },
  [`GET ${B}/calendar`]: { body: { date: '2026-10-08', gaps: [], conflicts: [], appointments: { a2: { recommendationId: 'r9', status: 'review_required', type: 'fill_gap', locked: true } }, utilizationPct: 70 } },
  [`GET ${B}/insights`]: { body: { items: [{ kind: 'duration', id: 'i1', branchId: 'b1', serviceId: 's1', technicianId: null, action: 'shorten', currentMin: 60, suggestedMin: 45, sampleSize: 31, reason: 'median 44 min', confidence: 0.8, status: 'review_required', version: 2, createdAt: '2026-10-07T00:00:00Z' }], total: 1 } },
  [`POST ${B}/insights/duration/i1/approve`]: { body: { ok: true } },
  [`GET ${B}/time-off`]: { body: [] },
  [`GET ${B}/service-profiles`]: { body: [] },
  [`GET ${B}/locks`]: { body: [{ appointmentId: 'a1', reason: 'VIP', lockedByUserId: 'u1', createdAt: '2026-10-08T10:00:00Z' }] },
  [`GET ${B}/usage`]: { body: { from: '2026-09-08', to: '2026-10-08', runs: 40, recommendations: 120, applied: 30, explanations: 12, llmCostMicroUsd: 1500000 } },
  // 200-technician §2: the screen asks for the day WITHOUT the roster (?roster=none); names come from the day's rows and the
  // technicians it picks come from the server-paged picker (GET /pos/booking/technicians)
  'GET /pos/booking/state': { body: { filters: { technicians: [], services: [{ serviceId: 's1', name: 'Gel Manicure', durationMinutes: 45 }, { serviceId: 's2', name: 'Nail Art', durationMinutes: 30 }], statuses: [], sources: [], serviceCategories: [], branches: [] }, bookings: { items: [{ appointmentId: 'a1', customerName: 'Jane Doe', startTime: '2026-10-08T14:00:00.000Z', technicianId: 't1', technicianName: 'Mia', status: 'confirmed', services: [] }, { appointmentId: 'a2', customerName: 'Kim Lee', startTime: '2026-10-08T15:00:00.000Z', technicianId: 't2', technicianName: 'Leo', status: 'booked', services: [] }] } } },
  'GET /pos/booking/technicians': (c: Call) => {
    const locate = new URL(c.url, 'http://x').searchParams.get('locate');
    const all = [{ technicianId: 't1', name: 'Mia', rosterNumber: 1, workingToday: true }, { technicianId: 't2', name: 'Leo', rosterNumber: 2, workingToday: true }];
    const list = locate ? all.filter((t) => t.technicianId === locate) : all;
    return { body: { date: '2026-10-08', technicians: list, total: list.length, totalAll: 2, workingCount: 2, page: 1, pageSize: 12, totalPages: 1, ...(locate ? { located: list.length ? { technicianId: locate, page: 1, index: 0 } : null } : {}) } };
  },
});
let routes: ReturnType<typeof defaults>;
let calls: Call[];
function install() {
  calls = [];
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input); const method = (init?.method || 'GET').toUpperCase();
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    const call = { url, method, body }; calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1(?=\/)/, '')   /* BUILD_PLAN Phase 12: the client calls /api/v1/<path> */.split('?')[0];
    const r = routes[`${method} ${path}`];
    const rep: Reply = typeof r === 'function' ? r(call) : r || { body: {} };
    const status = rep.status ?? 200;
    const text = rep.raw ?? JSON.stringify(rep.body ?? null);
    return { ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => text, json: async () => JSON.parse(text), headers: { get: () => null } } as any;
  }) as any;
}
const sent = (method: string, frag: string) => calls.filter((c) => c.method === method && c.url.includes(frag));
const renderScreen = (url = '/tenant/ai/scheduling-optimizer') => render(<MemoryRouter initialEntries={[url]}><POSAISchedulingOptimizerScreen /></MemoryRouter>);
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => { perms.deny = new Set(); server.r1 = rec(); routes = defaults(); install(); });

describe('Overview', () => {
  it('shows the latest run’s day measures and the review / customer counts', async () => {
    renderScreen();
    expect(await screen.findByText('71%')).toBeTruthy();
    expect(screen.getByText('90 min')).toBeTruthy();
    expect(screen.getByTestId('sched-last-run').textContent).toContain('scheduled scan');
    await waitFor(() => expect(sent('GET', 'status=review_required').length).toBeGreaterThan(0));
  });
  it('Run optimizer posts a branch_day run with a fresh idempotency key; a technician pick makes it technician_day', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Run optimizer'));
    await waitFor(() => expect(sent('POST', `${B}/runs`).length).toBe(1));
    const b1 = sent('POST', `${B}/runs`)[0].body;
    expect(b1).toMatchObject({ scope: 'branch_day' }); expect(typeof b1.idempotencyKey).toBe('string'); expect(b1.technicianId).toBeUndefined();
    expect(await screen.findByText(/1 recommendation\(s\), 2 gap/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Run for'));                       // the server-paged picker (§2), not a roster <select>
    fireEvent.click(await within(await screen.findByTestId('technician-picker')).findByRole('option', { name: /Leo/ }));
    fireEvent.click(screen.getByText('Run optimizer'));
    await waitFor(() => expect(sent('POST', `${B}/runs`).length).toBe(2));
    const b2 = sent('POST', `${B}/runs`)[1].body;
    expect(b2).toMatchObject({ scope: 'technician_day', technicianId: 't2' }); expect(b2.idempotencyKey).not.toBe(b1.idempotencyKey);
    fireEvent.click(screen.getByLabelText('Run for'));
    fireEvent.click(await screen.findByRole('option', { name: 'Whole location' }));
    fireEvent.click(screen.getByText('Run optimizer'));
    await waitFor(() => expect(sent('POST', `${B}/runs`).length).toBe(3));
    expect(sent('POST', `${B}/runs`)[2].body.idempotencyKey).not.toBe(b1.idempotencyKey);   // one key per click, never reused
  });
  it('without ai_scheduling.generate there is no Run button; when platform-killed it says so', async () => {
    perms.deny = new Set(['ai_scheduling.generate']);
    routes[`GET ${B}/settings`] = { body: settingsView({ effective: { ...settingsView().effective, platformKilled: true } }) };
    renderScreen();
    expect(await screen.findByTestId('sched-off')).toHaveTextContent('paused platform-wide');
    expect(screen.queryByText('Run optimizer')).toBeNull();
  });
  it('no ai_scheduling.view → no workspace', async () => {
    perms.deny = new Set(['ai_scheduling.view']);
    renderScreen();
    expect(screen.getByText(/do not have access/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.filter((c) => c.url.includes(B)).length).toBe(0);   // nothing asked of the optimizer API
  });
});

describe('Recommendations', () => {
  it('filters go to the server as real query params (audit bug: {query})', async () => {
    renderScreen(); tab('Recommendations');
    expect((await screen.findAllByTestId('sched-rec-row')).length).toBe(2);
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'applied' } });
    fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'fill_gap' } });
    await waitFor(() => expect(sent('GET', `${B}/recommendations?`).some((c) => c.url.includes('status=applied') && c.url.includes('type=fill_gap'))).toBe(true));
    expect(calls.some((c) => c.url.includes('query='))).toBe(false);
  });

  it('detail: simulation before/after, benefit, versions; Accept sends expectedVersion and shows the new status', async () => {
    renderScreen(); tab('Recommendations');
    fireEvent.click((await screen.findAllByTestId('sched-rec-row'))[0]);
    const d = await screen.findByTestId('sched-rec-detail');
    expect(within(d).getByLabelText('Simulation before and after').textContent).toContain('78%');
    expect(within(d).getByText('+ Closes a 30 min gap for Leo')).toBeTruthy();
    expect(within(d).getByTestId('sched-proposed').textContent).toContain('11:15 AM');
    expect(within(d).getByTestId('sched-proposed').textContent).toContain('Leo');
    expect(within(d).getByTestId('sched-versions').textContent).toContain('settings v4');
    fireEvent.click(within(d).getByText('Accept'));
    await waitFor(() => expect(sent('POST', '/r1/accept')[0]?.body).toEqual({ expectedVersion: 5, reason: null }));
    expect(await within(d).findByText(/customer has been asked/)).toBeTruthy();
    expect(within(d).getByTestId('sched-rec-status').textContent).toBe('Waiting for the customer');
  });

  it('reject needs a reason; the reason is sent with expectedVersion', async () => {
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    await within(d).findByText('Reject');
    fireEvent.click(within(d).getByText('Reject'));
    expect(await within(d).findByText('Add a short reason first.')).toBeTruthy();
    expect(sent('POST', '/reject').length).toBe(0);
    fireEvent.change(within(d).getByLabelText('Reason'), { target: { value: 'guest is a regular at 10' } });
    fireEvent.click(within(d).getByText('Reject'));
    await waitFor(() => expect(sent('POST', '/r1/reject')[0]?.body).toEqual({ expectedVersion: 5, reason: 'guest is a regular at 10' }));
  });

  it('409 VERSION_CONFLICT → plain message and the detail is refetched', async () => {
    routes[`POST ${B}/recommendations/r1/accept`] = { status: 409, body: { code: 'VERSION_CONFLICT', message: 'conflict' } };
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    const before = sent('GET', `${B}/recommendations/r1`).length;
    fireEvent.click(await within(d).findByText('Accept'));
    expect(await within(d).findByText(/Someone else changed this recommendation/)).toBeTruthy();
    await waitFor(() => expect(sent('GET', `${B}/recommendations/r1`).length).toBeGreaterThan(before));
  });

  it('apply sends only expectedVersion; 409 STALE_SCHEDULE explains nothing was applied and refetches', async () => {
    routes[`GET ${B}/recommendations/r1`] = { body: { recommendation: rec({ status: 'customer_approved', version: 9 }) } };
    routes[`POST ${B}/recommendations/r1/apply`] = { status: 409, body: { code: 'STALE_SCHEDULE', message: 'stale' } };
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    fireEvent.click(await within(d).findByText('Apply'));
    await waitFor(() => expect(sent('POST', '/r1/apply')[0]?.body).toEqual({ expectedVersion: 9 }));
    expect(await within(d).findByText(/changed after this was computed, so nothing was applied/)).toBeTruthy();
    await waitFor(() => expect(sent('GET', `${B}/recommendations/r1`).length).toBeGreaterThan(1));
  });

  it('applied → Roll back; application_failed → Retry; both hidden without ai_scheduling.apply', async () => {
    routes[`GET ${B}/recommendations/r1`] = { body: { recommendation: rec({ status: 'applied', version: 11 }) } };
    routes[`POST ${B}/recommendations/r1/rollback`] = { body: { recommendation: rec({ status: 'rolled_back', version: 12 }), application: { status: 'applied', appliedVia: 'booking', externalRef: null, errorCode: null, attempt: 1 } } };
    const { unmount } = renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    fireEvent.click(await within(d).findByText('Roll back'));
    await waitFor(() => expect(sent('POST', '/r1/rollback')[0]?.body).toEqual({ expectedVersion: 11 }));
    unmount();
    perms.deny = new Set(['ai_scheduling.apply', 'ai_scheduling.review']);
    routes[`GET ${B}/recommendations/r1`] = { body: { recommendation: rec({ status: 'application_failed' }) } };
    renderScreen('/x?rec=r1');
    const d2 = await screen.findByTestId('sched-rec-detail');
    await within(d2).findByText(/a manager can retry/);
    expect(within(d2).queryByText('Retry apply')).toBeNull();
    expect(within(d2).queryByText('Accept')).toBeNull();
  });

  it('accepted → Apply only with ai_scheduling.apply', async () => {
    perms.deny = new Set(['ai_scheduling.apply']);
    routes[`GET ${B}/recommendations/r1`] = { body: { recommendation: rec({ status: 'accepted', requiresCustomerApproval: false }) } };
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    await within(d).findByText('Accepted — ready to apply');
    expect(within(d).queryByText('Apply')).toBeNull();
  });

  it('Explain asks the server and shows the labelled explanation', async () => {
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    fireEvent.click(await within(d).findByText('Explain'));
    expect(await within(d).findByText('Moving Jane to 11:15 fills Leo’s gap.')).toBeTruthy();
    expect(within(d).getByText('template')).toBeTruthy();
    expect(sent('POST', '/r1/explain').length).toBe(1);
  });

  it('Suggest: only appointment + target are sent; a 422 lists the broken rules', async () => {
    renderScreen(); tab('Recommendations');
    await waitFor(() => expect(screen.getByLabelText('Appointment').querySelectorAll('option').length).toBe(3));
    fireEvent.change(screen.getByLabelText('Appointment'), { target: { value: 'a1' } });
    fireEvent.click(screen.getByLabelText('Target technician (optional)'));
    fireEvent.click(await within(await screen.findByTestId('technician-picker')).findByRole('option', { name: /Leo/ }));
    fireEvent.click(screen.getByText('Suggest'));
    await waitFor(() => expect(sent('POST', '/recommendations/generate')[0]?.body).toEqual({ appointmentId: 'a1', target: { date: null, startTime: null, technicianId: 't2' } }));
    expect(await screen.findByText('Leo does not do acrylic')).toBeTruthy();
    expect(screen.getByText(/breaks a hard rule/)).toBeTruthy();
  });
});

describe('Find a time, gaps & conflicts, approvals, insights, settings, usage', () => {
  it('Find a time: options with per-service blocks; hold + release', async () => {
    renderScreen(); tab('Find a time');
    fireEvent.click(await screen.findByLabelText('Gel Manicure'));
    fireEvent.click(screen.getByLabelText('Nail Art'));
    fireEvent.click(screen.getByText('Find & hold the best'));
    await waitFor(() => expect(sent('POST', `${B}/options`)[0]?.body).toMatchObject({ serviceIds: ['s1', 's2'], limit: 5, hold: { channel: 'pos' } }));
    const opt = await screen.findByTestId('sched-option');
    expect(opt.textContent).toContain('Gel Manicure 11:00 AM–11:45 AM → Nail Art 11:45 AM–12:15 PM');
    expect(opt.textContent).toContain('held');
    fireEvent.click(screen.getByText('Release hold'));
    await waitFor(() => expect(sent('POST', '/holds/h1/release').length).toBe(1));
  });

  it('Gaps & conflicts: the latest run’s gaps and conflicts', async () => {
    renderScreen(); tab('Gaps & conflicts');
    expect((await screen.findByTestId('sched-gap')).textContent).toContain('Gel Manicure');
    expect(screen.getByTestId('sched-conflict').textContent).toContain('Mia has two guests at 10:00');
    expect(sent('GET', `${B}/runs/run1`).length).toBe(1);
  });

  it('Customer approvals: phone decision sends approved + expectedVersion', async () => {
    renderScreen(); tab('Customer approvals');
    const row = await screen.findByTestId('sched-proposal-row');
    expect(row.textContent).toContain('Customer notified');
    fireEvent.click(within(row).getByText('Declined by phone'));
    await waitFor(() => expect(sent('POST', '/r3/customer-decision')[0]?.body).toEqual({ approved: false, expectedVersion: 5 }));
    expect(await screen.findByText(/original appointment stays/)).toBeTruthy();
  });

  it('Insights: approve sends expectedVersion; no buttons without ai_scheduling.approve', async () => {
    const { unmount } = renderScreen(); tab('Insights');
    const row = await screen.findByTestId('sched-insight');
    expect(row.textContent).toContain('Gel Manicure: 60 → 45 min · 31 visits');
    fireEvent.click(within(row).getByText('Approve'));
    await waitFor(() => expect(sent('POST', '/insights/duration/i1/approve')[0]?.body).toEqual({ expectedVersion: 2, reason: null }));
    unmount();
    perms.deny = new Set(['ai_scheduling.approve']);
    renderScreen(); tab('Insights');
    const r2 = await screen.findByTestId('sched-insight');
    expect(within(r2).queryByText('Approve')).toBeNull();
  });

  it('Settings: read-only without configure; with it, saves the layer conditionally on its version', async () => {
    perms.deny = new Set(['ai_scheduling.configure']);
    const { unmount } = renderScreen(); tab('Settings');
    expect(await screen.findByTestId('sched-settings-ro')).toBeTruthy();
    expect(screen.queryByText('Save settings')).toBeNull();
    expect((screen.getByLabelText('Emergency stop') as HTMLSelectElement).disabled).toBe(true);
    unmount();
    perms.deny = new Set();
    renderScreen(); tab('Settings');
    await waitFor(() => expect((screen.getByLabelText('Smallest useful gap (min)') as HTMLInputElement).value).toBe('25'));
    fireEvent.change(screen.getByLabelText('Emergency stop'), { target: { value: 'on' } });
    fireEvent.change(screen.getByLabelText('Look ahead (days)'), { target: { value: '21' } });
    fireEvent.click(screen.getByText('Save settings'));
    await waitFor(() => expect(sent('PUT', `${B}/settings`).length).toBe(1));
    expect(sent('PUT', `${B}/settings`)[0].body).toEqual({ level: 'branch', expectedVersion: 6, enabled: null, killSwitch: true, config: { gapMinServiceMin: 25, maxHorizonDays: 21 } });
    expect(screen.getByTestId('sched-settings-version').textContent).toContain('v6');
  });

  it('Usage & export: the period summary; export hidden without ai_scheduling.export', async () => {
    perms.deny = new Set(['ai_scheduling.export']);
    renderScreen(); tab('Usage & export');
    expect(await screen.findByText('$1.50')).toBeTruthy();
    expect(screen.queryByText('Export runs (CSV)')).toBeNull();
  });

  it('Time off & locks: a calendar-locked appointment shows as locked and can be unlocked', async () => {
    renderScreen(); tab('Time off & locks');
    await waitFor(() => expect(screen.getAllByTestId('sched-lock-row').length).toBe(2));
    const kim = screen.getAllByTestId('sched-lock-row')[1];
    await waitFor(() => expect(kim.textContent).toContain('locked'));                                  // computed (calendar)
    await waitFor(() => expect(screen.getAllByTestId('sched-lock-row')[0].textContent).toContain('locked'));   // staff lock (GET locks)
    fireEvent.click(within(kim).getByText('Unlock'));
    await waitFor(() => expect(sent('DELETE', `${B}/locks/a2`).length).toBe(1));
  });
});

describe('Realtime', () => {
  it('a schedule_* event for "ai-scheduling-optimizer" reloads the cards', async () => {
    renderScreen();
    await screen.findByText('71%');
    const before = sent('GET', `${B}/runs`).length;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'schedule_run_completed', screens: ['ai-scheduling-optimizer'] } })); await new Promise((r) => setTimeout(r, 400)); });
    await waitFor(() => expect(sent('GET', `${B}/runs`).length).toBeGreaterThan(before));
  });
});

// English + Vietnamese POS mandate (WP-C1): the optimizer reads in Vietnamese — tabs, recommendation statuses / types,
// clock times, run / proposal / conflict codes, the settings labels — with no English left (salon data and the server's own
// prose — conflict messages, explanations, reasons — stay as sent).
describe('AI Scheduling Optimizer in Vietnamese (WP-C1)', () => {
  const NAMES = ['Mia', 'Leo', 'Jane Doe', 'Gel Manicure', 'Nail Art', 'Closes a 30 min gap for Leo', 'The customer moves 75 minutes later', 'median 44 min', 'Mia has two guests at 10:00', 'VIP', 'r7', 'e2', 'v6', 'v4', 'ms'];
  afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
  it('tabs, recommendations, runs, approvals and settings are Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = renderScreen();
    await screen.findByRole('tab', { name: 'Gợi ý' }).catch(() => null);
    const scan = () => leftoverEnglish(container, NAMES).join(' | ');
    await waitFor(() => expect(screen.getAllByRole('tab').length).toBe(10));
    expect(screen.getByRole('tab', { name: 'Nghỉ phép & khóa lịch' })).toBeTruthy();
    expect(scan()).toBe('');
    for (const i of [1, 3, 4, 5, 6, 7]) {
      fireEvent.click(screen.getAllByRole('tab')[i]);
      await new Promise((r) => setTimeout(r, 30));
      await waitFor(() => expect(container.textContent).not.toMatch(/Đang tải/));
      expect(scan(), `tab ${i}`).toBe('');
    }
    expect(screen.queryByText(/AM|PM/)).toBeNull();
  });
});

// Vietnamese POS leftover (Oct 27 2026): the optimizer's server-written English — benefits, hard-rule violations, the
// explanation, conflicts, find-a-time reasons, insight reasons — is worded in Vietnamese from codes; an AI-written
// explanation is free English prose and is shown labelled as English under the worded facts.
describe('AI Scheduling Optimizer — server text worded in Vietnamese', () => {
  afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
  it('detail: benefits, violations and the explanation from codes; the AI prose labelled English', async () => {
    server.r1 = rec({ expectedBenefit: ['saves ~30 min technician idle time', 'improves utilization by ~7%', 'fills 1 schedule gap(s)'], possibleDownside: [],
      violations: [{ code: 'MISSING_SKILL', message: 'technician not qualified for: s1', vars: { services: 's1' } }, { code: 'ON_TIME_OFF', message: 'technician is on approved time off' }],
      explanation: 'Moving Jane to 11:15 fills Leo’s gap.', explanationSource: 'llm' });
    await setLanguage('vi');
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    expect(await within(d).findByText('+ giảm ~30 phút thợ ngồi không')).toBeTruthy();
    expect(within(d).getByText('+ tăng mức sử dụng ~7%')).toBeTruthy();
    expect(within(d).getByText('+ lấp 1 khoảng trống trong lịch')).toBeTruthy();
    expect(within(d).getByText(/thợ chưa đủ điều kiện làm: s1/)).toBeTruthy();
    expect(within(d).getByText(/thợ đang nghỉ phép đã duyệt/)).toBeTruthy();
    const ex = within(d).getByTestId('sched-explanation');
    expect(ex.textContent).toContain('Dời lịch hẹn từ 10:00 sang 11:15 với thợ khác.');
    expect(ex.textContent).toContain('Lý do: giảm ~30 phút thợ ngồi không; tăng mức sử dụng ~7%; lấp 1 khoảng trống trong lịch.');
    expect(ex.textContent).toContain('Khách phải đồng ý trước khi thay đổi bất cứ điều gì.');
    expect(ex.textContent).toContain('Độ tin cậy 82%.');
    const ai = within(d).getByTestId('sched-explanation-ai-english');
    expect(ai.getAttribute('lang')).toBe('en');
    expect(ai.textContent).toBe('Giải thích do AI viết (tiếng Anh): Moving Jane to 11:15 fills Leo’s gap.');
    // English shows the stored text exactly
    await act(async () => { await setLanguage('en'); });
  });
  it('§120: an AI explanation stored in Vietnamese (explanationLanguage vi) is shown as is in Vietnamese; English labels it Vietnamese under the worded facts', async () => {
    server.r1 = rec({ expectedBenefit: ['saves ~30 min technician idle time'], possibleDownside: [], violations: [],
      explanation: 'Dời lịch của khách sang 11:15 để lấp khoảng trống của thợ Leo.', explanationSource: 'llm', explanationLanguage: 'vi' });
    await setLanguage('vi');
    renderScreen('/x?rec=r1');
    const d = await screen.findByTestId('sched-rec-detail');
    const ai = await within(d).findByTestId('sched-explanation-ai');
    expect(ai.getAttribute('lang')).toBe('vi');
    expect(ai.textContent).toBe('Dời lịch của khách sang 11:15 để lấp khoảng trống của thợ Leo.');
    expect(within(d).queryByTestId('sched-explanation-ai-english')).toBeNull();
    // an English screen (the app root re-renders every screen on a switch; here: a fresh render in English)
    cleanup();
    await act(async () => { await setLanguage('en'); });
    renderScreen('/x?rec=r1');
    const d2 = await screen.findByTestId('sched-rec-detail');
    const other = await within(d2).findByTestId('sched-explanation-ai-vietnamese');
    expect(other.getAttribute('lang')).toBe('vi');
    expect(other.textContent).toBe('AI explanation (Vietnamese): Dời lịch của khách sang 11:15 để lấp khoảng trống của thợ Leo.');
  });
  it('insight reasons from codes (find-a-time reasons and run conflicts: same helper, EN-equality proven server-side)', async () => {
    routes[`POST ${B}/options`] = { body: { options: [{ id: 't2@2026-10-08T11:00', technicianId: 't2', technicianName: 'Leo', date: '2026-10-08', startTime: '11:00', endTime: '11:45', score: 0.9, breakdown: {}, blocks: [{ serviceId: 's1', startTime: '11:00', endTime: '11:45' }],
      reasons: ['fills an open gap exactly', 'well inside the technician’s shift'], reasonCodes: ['FILLS_GAP', 'INSIDE_SHIFT'], fallback: false }], forecastAvailable: true, hold: null } };
    routes[`GET ${B}/runs/run1`] = { body: { run: run(), gaps: [], conflicts: [{ id: 'c1', type: 'STATION_OVERBOOK', severity: 'warning', appointmentIds: ['a1'], technicianId: null, date: '2026-10-08', message: 'station s9 over capacity', resolved: false, messageCoded: { code: 'SCHED_CONFLICT.STATION_OVERBOOK', vars: { station: 's9' } } }], recommendations: [] } };
    routes[`GET ${B}/insights`] = { body: { items: [{ kind: 'duration', id: 'i1', branchId: 'b1', serviceId: 's1', technicianId: null, action: 'decrease', currentMin: 60, suggestedMin: 45, sampleSize: 31, confidence: 0.8, status: 'review_required', version: 2, createdAt: '2026-10-07T00:00:00Z',
      reason: 'Median of 31 completed services is 45 min (configured 60 min; middle half 40–50 min).', reasonCoded: { code: 'SCHED_INSIGHT.DURATION_MEDIAN', vars: { n: 31, median: 45, configured: 60, p25: 40, p75: 50 } } }], total: 1 } };
    await setLanguage('vi');
    const { container } = renderScreen('/x?tab=insights');
    await waitFor(() => expect(container.textContent).toContain('Trung vị của 31 dịch vụ đã làm xong là 45 phút (đang cài 60 phút; nửa giữa 40–50 phút).'), { timeout: 3000 });
    expect(container.textContent).not.toContain('Median of 31');
  });
});
