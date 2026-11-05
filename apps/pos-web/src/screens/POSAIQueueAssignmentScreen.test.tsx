// POSAIQueueAssignmentScreen.test.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment → complete). Tests go through the REAL
// api client with a routed fetch, so a wrong path, verb or body fails here (the old test mocked the client and never
// noticed that GET /rotation-policy answered a bare string — audit bug 7).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const perms = { deny: new Set<string>() };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
const auth = { role: 'OWNER' as string | null };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: auth.role ? { role: auth.role } : null }) }));

import { POSAIQueueAssignmentScreen } from './POSAIQueueAssignmentScreen';
import { settingsConflictMessage } from './ai-queue/AIQueueSettingsCard';

type Call = { url: string; method: string; body?: any };
type Reply = { status?: number; body?: any; raw?: string };
const settingsResp = (over: any = {}) => ({
  salon: { waitApproachingMin: 10, waitExceededMin: 20, waitSevereMin: 30, waitCriticalMin: 45, stuckMinutes: 30, longServiceFactor: 1.5, congestionWaitingPerTech: 2, lateGraceMin: 10, rotationPolicy: 'hybrid', fixedOrder: [], autoEnabled: false, autoConfidenceFloor: 0.75, autoMaxPerRun: 5, autoDelaySeconds: 120, autoExclusions: {}, version: 3, autoKilled: false, autoKilledReason: null, ...(over.salon || {}) },
  // GET settings (ops.service getSettings): the location's own values with EVERY key present — null = inherits
  branch: { version: 7, waitApproachingMin: null, waitExceededMin: null, waitSevereMin: null, waitCriticalMin: null, stuckMinutes: 25, longServiceFactor: null, congestionWaitingPerTech: null, lateGraceMin: null, rotationPolicy: null, fixedOrder: null, autoEnabled: null, autoConfidenceFloor: null, autoMaxPerRun: null, autoDelaySeconds: null, autoExclusions: null, ...(over.branch || {}) },
  effective: { configVersion: '3.7', autoAllowed: false, autoBlockedBy: 'disabled', salonAutoKilled: !!over.salon?.autoKilled },
  versions: [{ version: 7, branchId: 'b1', change: 'settings', reason: 'busy saturdays', changedBy: 'u1', createdAt: '2026-10-06T15:00:00Z' }],
  canEditSalon: over.canEditSalon ?? true,
});
// GET auto-config (QueueAutoConfigView)
const autoView = (over: any = {}) => ({ enabled: true, confidenceFloor: 0.8, maxPerRun: 3, delaySeconds: 90, exclusions: { vip: true }, autoAllowed: false, autoBlockedBy: 'salon_kill_switch', salonAutoKilled: true, salonAutoKilledReason: 'double bookings', platformAutoActionsDisabled: false, configVersion: '3.7', branchVersion: 7, ...over });
const alertRow = (over: any = {}) => ({ id: 'a1', tenantId: 'tn', branchId: 'b1', queueEntryId: 'q1', type: 'waiting_too_long', severity: 'high', reason: 'Waiting 35 min', ageMinutes: 35, status: 'open', technicianId: null, autoResolved: false, resolution: null, reviewNote: null, notifiedSeverity: null, acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null, lastSeenAt: null, createdAt: '2026-10-07T14:30:00Z', updatedAt: '2026-10-07T14:30:00Z', ...over });
const defaults = (): Record<string, Reply | ((c: Call) => Reply)> => ({
  'GET /pos/ai-queue-assignment/overview': { body: { waiting: 4, unassigned: 2, inService: 3, avgWaitMinutes: 12, longestWaitMinutes: 31, byWaitLevel: { none: 1, approaching: 2, exceeded: 1, severe: 0, critical: 0 }, congestion: 'busy', freeTechnicians: 1, openAlerts: 1, byType: { waiting_too_long: 1 }, autoEnabled: false, autoAllowed: false, autoBlockedBy: 'disabled', salonAutoKilled: false, configVersion: '3.7', lastScanAt: null, lastAutoRunAt: null, decisionsToday: { accepted: 5, rejected: 1, overridden: 2, keptUnassigned: 0, autoAssigned: 0 }, technicians: [{ technicianId: 't1', name: 'Mia', status: 'available', activeAssignments: 0, availableInMinutes: 0 }, { technicianId: 't2', name: null, status: 'in_service', activeAssignments: 1, availableInMinutes: 20 }] } },
  'GET /pos/technicians/state': { body: { rows: { items: [{ technicianId: 't1', displayName: 'Mia' }, { technicianId: 't2', displayName: 'Leo' }, { technicianId: 't3', displayName: 'Ana' }] } } },
  'GET /pos/queue/items': { body: { items: [{ queueItemId: 'q1', customerName: 'Jessica Miller', status: 'waiting', assignedTechnicianId: null, actualWaitMinutes: 14 }, { queueItemId: 'q9', customerName: 'Done Person', status: 'completed' }], pagination: {} } },
  // GET entries/:id/panel (QueueAssignmentPanel): entry from assignmentInputs, candidates at the TOP level
  'GET /pos/ai-queue-assignment/entries/q1/panel': { body: { candidates: [
    { technicianId: 't1', name: 'Mia', branchId: 'b1', available: true, eligible: true, reasons: [], matchScore: 0.9, activeAssignments: 0, maxConcurrent: 1, availableInMinutes: 0, shiftEndsInMinutes: 300, nextAppointmentInMinutes: null, onBreak: false, blocked: false, isPrevious: true, isRequested: false, skills: ['gel'] },
    { technicianId: 't3', name: 'Ana', branchId: 'b1', available: false, eligible: false, reasons: ['on break'], matchScore: null, activeAssignments: 0, maxConcurrent: 1, availableInMinutes: 15, shiftEndsInMinutes: 300, nextAppointmentInMinutes: null, onBreak: true, blocked: false, isPrevious: false, isRequested: false, skills: [] },
  ], entry: { queueEntryId: 'q1', branchId: 'b1', requiredCategories: [], serviceDurationMinutes: 45, version: 4, requestedTechnicianId: 't2', previousTechnicianId: 't1', isVip: false, isAppointment: false, lateMinutes: 0, groupId: null, lock: null }, recommendation: { recommendationId: 'r1', queueEntryId: 'q1', recommended: { technicianId: 't1', name: 'Mia', eligible: true, matchScore: 0.9, reasons: ['Free now', 'Has the skill'], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 45 }, alternates: [{ technicianId: 't3', name: 'Ana', eligible: true, matchScore: 0.6, reasons: [], warnings: [], estimatedStartInMinutes: 5, estimatedCompletionInMinutes: 50 }], confidence: 0.82, conflicts: [], warnings: [], requiredAction: 'assignable', ruleVersion: 'r1', recoVersion: 'v1', generatedAt: '2026-10-07T15:00:00Z', configVersion: '3.7', queueVersion: 4 }, decisions: [{ id: 'd0', recommendationId: 'r0', queueEntryId: 'q1', decision: 'rejected', chosenTechnicianId: null, previousTechnicianId: null, reason: 'guest asked for Leo', feedbackCode: 'customer_preference', applied: false, idempotencyKey: null, decidedBy: 'u1', createdAt: '2026-10-07T14:00:00Z' }], lock: null } },
  'GET /pos/ai-queue-assignment/recommendations/r1/explanation': { body: { explanation: 'Mia is free now and does gel.', source: 'fallback' } },
  'POST /pos/ai-queue-assignment/recommendations/r1/decision': (c) => ({ body: { decision: { id: 'd1', recommendationId: 'r1', queueEntryId: 'q1', decision: c.body.decision, chosenTechnicianId: c.body.chosenTechnicianId ?? (c.body.decision === 'accepted' ? 't1' : null), previousTechnicianId: null, reason: c.body.reason ?? null, feedbackCode: c.body.feedbackCode ?? null, applied: c.body.decision === 'accepted' || c.body.decision === 'overridden', idempotencyKey: c.body.idempotencyKey, decidedBy: 'u1', createdAt: '2026-10-07T15:01:00Z' }, applied: c.body.decision === 'accepted' || c.body.decision === 'overridden', queueItem: {} } }),
  'GET /pos/ai-queue-assignment/entries/q1/decisions': { body: [{ id: 'd0', recommendationId: 'r0', queueEntryId: 'q1', decision: 'rejected', reason: 'older', createdAt: '2026-10-07T13:00:00Z' }, { id: 'dx', recommendationId: null, queueEntryId: 'q1', decision: 'auto_assigned', chosenTechnicianId: 't1', createdAt: '2026-10-07T12:00:00Z' }] },
  'GET /pos/ai-queue-assignment/recommendations/r0': { body: { recommendationId: 'r0', queueEntryId: 'q1', recommended: { technicianId: 't3', name: 'Ana', eligible: true, matchScore: 0.7, reasons: [], warnings: [], estimatedStartInMinutes: 0, estimatedCompletionInMinutes: 30 }, alternates: [], confidence: 0.55, conflicts: [], warnings: [], requiredAction: 'staff_review', ruleVersion: 'r', recoVersion: 'v', generatedAt: '2026-10-07T13:59:00Z' } },
  // the ops alerts repository's AlertRecord: closed = status 'resolved' + autoResolved / resolution
  'GET /pos/ai-queue-assignment/alerts': (c) => ({ body: c.url.includes('status=all')
    ? [alertRow({ id: 'a1' }), alertRow({ id: 'a2', queueEntryId: 'q2', type: 'unassigned', severity: 'warning', reason: 'Nobody assigned for 12 min', status: 'resolved', autoResolved: true, resolution: 'condition_cleared' }), alertRow({ id: 'a3', queueEntryId: 'q3', type: 'stuck_record', reason: 'No change for 40 min', status: 'resolved', resolution: 'repaired:unassign' })]
    // a misbehaving server that still sends a resolved alert in the OPEN list — the card must drop it (bug 9)
    : [alertRow({ id: 'a1' }), alertRow({ id: 'a4', queueEntryId: 'q4', type: 'stuck_record', reason: 'Assigned with no change for 41 min', status: 'acknowledged' }), alertRow({ id: 'a3', queueEntryId: 'q3', type: 'stuck_record', reason: 'No change for 40 min', status: 'resolved', resolution: 'repaired:unassign' })] }),
  'POST /pos/ai-queue-assignment/alerts/a1/repair': (c) => ({ body: { alert: alertRow({ id: 'a1', status: 'resolved', resolution: `repaired:${c.body.action}` }), action: c.body.action, queueItemId: 'q1', result: {} } }),
  'GET /pos/ai-queue-assignment/wait-thresholds': { body: { approachingMin: 10, exceededMin: 20, severeMin: 30, criticalMin: 45, configVersion: '3.7' } },
  'PUT /pos/ai-queue-assignment/wait-thresholds': (c) => ({ body: { ...c.body, configVersion: '3.8' } }),
  'GET /pos/ai-queue-assignment/settings': { body: settingsResp() },
  // PUT settings answers { effective, scope } — the card reloads the full view
  'PUT /pos/ai-queue-assignment/settings': { body: { effective: settingsResp().effective, scope: 'branch' } },
  'GET /pos/ai-queue-assignment/settings/versions': { body: [] },
  'GET /pos/ai-queue-assignment/rotation-policy': { body: { policy: 'manual_order', fixedOrder: ['t2', 't1'] } },
  'PUT /pos/ai-queue-assignment/rotation-policy': (c) => ({ body: c.body }),
  'GET /pos/ai-queue-assignment/auto-config': { body: autoView() },
  'POST /pos/ai-queue-assignment/auto/kill': { body: autoView() },
  'POST /pos/ai-queue-assignment/auto/unkill': { body: autoView({ salonAutoKilled: false, autoBlockedBy: null, autoAllowed: true }) },
  'POST /pos/ai-queue-assignment/auto/run': { body: { enabled: true, allowed: false, blockedBy: 'salon_kill_switch', assigned: 0, considered: 0, skipped: [] } },
  // GET analytics (ops.service analytics) — rates 0–1 over staff decisions; auto-assignments apart
  'GET /pos/ai-queue-assignment/analytics': { body: { range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-08T00:00:00.000Z' }, timeZone: 'America/New_York',
    decisions: { total: 10, accepted: 6, rejected: 2, overridden: 1, keptUnassigned: 0, acceptanceRate: 0.6, overrideRate: 0.1, rejectionRate: 0.2, topRejectionReasons: [{ reason: 'guest asked for Leo', count: 2 }], byDay: [], byChosenTechnician: [], autoAssigned: 1, staffTotal: 9, topFeedbackCodes: [{ code: 'customer_preference', count: 2 }], byHour: [] },
    waits: { served: 14, avgMinutes: 11, medianMinutes: 9, p90Minutes: 25, longestMinutes: 40, byHour: [], byTechnician: [] },
    byTechnician: [{ technicianId: 't1', name: 'Mia', served: 8, avgWaitMinutes: 10, chosenByStaff: 5, autoAssigned: 1, overriddenTo: 0 }],
    byHour: [{ hour: 10, served: 4, avgWaitMinutes: 12, decisions: 3, autoAssigned: 0 }],
    alerts: { total: 5, autoResolved: 3, byType: { waiting_too_long: 5 } } } },
  'GET /pos/ai-queue-assignment/decisions/analytics': { body: { total: 10, accepted: 6, rejected: 2, overridden: 1, keptUnassigned: 0, acceptanceRate: 0.6, overrideRate: 0.1, rejectionRate: 0.2, topRejectionReasons: [{ reason: 'customer_preference', count: 2 }], byDay: [], byChosenTechnician: [] } },
  'GET /pos/ai-queue-assignment/decisions': { body: [{ id: 'h1', recommendationId: 'r5', queueEntryId: 'q5', decision: 'overridden', chosenTechnicianId: 't3', reason: 'regular', createdAt: '2026-10-07T10:00:00Z' }] },
  'GET /pos/ai-queue-assignment/usage': { body: { range: { from: 'x', to: 'y' }, byStatus: { success: 9 }, byAction: { 'queue.explain_recommendation': 7 }, calls: 9, costMicroUsd: 1250000, recommendations: 21, explanations: 7 } },
  'GET /pos/ai-queue-assignment/export': { body: { format: 'csv', filename: 'decisions.csv', csv: 'a,b\n1,2', rows: 1 } },
  'POST /pos/queue/items/q1/lock': { body: { queueItemId: 'q1', customerName: 'Jessica Miller', version: 5, lock: { lockId: 'l1', technicianId: null, reason: 'x', lockedBy: 'u1', expiresAt: null, createdAt: '2026-10-07T15:00:00Z' } } },
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
const renderScreen = () => render(<MemoryRouter><POSAIQueueAssignmentScreen /></MemoryRouter>);
const pickJessica = async () => { fireEvent.click(await screen.findByRole('button', { name: /Jessica Miller/ })); await screen.findByText(/Suggested: Mia/); };

beforeEach(() => { perms.deny = new Set(); auth.role = 'OWNER'; routes = defaults(); install(); });

describe('POSAIQueueAssignmentScreen — overview + layout', () => {
  it('renders the overview tiles from GET overview', async () => {
    renderScreen();
    expect(screen.getByText('AI Queue Assignment')).toBeTruthy();
    expect(await screen.findByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('31 min')).toBeTruthy();
    expect(screen.getByText(/5 accepted · 1 rejected · 2 overridden · 0 auto-assigned/)).toBeTruthy();
  });
});

describe('Rotation policy — JSON load (audit bug 7)', () => {
  it('loads { policy, fixedOrder } JSON and shows the fixed turn order by name', async () => {
    renderScreen();
    const sel = await screen.findByLabelText('Rotation policy') as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe('manual_order'));
    const order = screen.getByLabelText('Fixed turn order');
    await waitFor(() => expect(within(order).getByText('Leo')).toBeTruthy());
    const names = within(order).getAllByText(/^(Leo|Mia)$/).map((e) => e.textContent);
    expect(names).toEqual(['Leo', 'Mia']);
  });

  it('saves the reordered fixed order as JSON { policy, fixedOrder }', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Move Mia up'));
    fireEvent.click(screen.getByText('Save rotation'));
    await waitFor(() => expect(sent('PUT', '/rotation-policy')[0]?.body).toEqual({ policy: 'manual_order', fixedOrder: ['t1', 't2'] }));
  });

  it('an old bare-string answer fails ONLY the rotation card — alerts and the rest still load', async () => {
    routes['GET /pos/ai-queue-assignment/rotation-policy'] = { raw: 'hybrid' };
    renderScreen();
    expect(await screen.findByText('Waiting 35 min')).toBeTruthy();
    expect(await screen.findByText(/could not read/i)).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});

describe('Alerts (audit bug 9)', () => {
  it('asks for OPEN alerts by default and never lists a resolved one', async () => {
    renderScreen();
    expect(await screen.findByText('Waiting 35 min')).toBeTruthy();
    expect(sent('GET', '/alerts?status=open').length).toBeGreaterThan(0);
    expect(screen.queryByText('No change for 40 min')).toBeNull();
    expect(within(screen.getByTestId('alert-a1')).getByText('Resolve')).toBeTruthy();
  });

  it('"Show resolved" lists closed alerts, labels auto-resolved ones as such and offers them no actions', async () => {
    renderScreen();
    await screen.findByText('Waiting 35 min');
    fireEvent.click(screen.getByLabelText(/Show resolved/));
    const auto = await screen.findByTestId('alert-a2');
    expect(within(auto).getByText('Auto-resolved — the condition cleared')).toBeTruthy();
    expect(within(auto).queryByText('Resolve')).toBeNull();
    expect(within(screen.getByTestId('alert-a3')).queryByText('Resolve')).toBeNull();
    expect(within(screen.getByTestId('alert-a3')).getByText('Repaired — unassigned')).toBeTruthy();
    expect(sent('GET', '/alerts?status=all').length).toBeGreaterThan(0);
  });

  it('shows the wait levels (GET wait-thresholds) and saves a quick adjust (PUT wait-thresholds)', async () => {
    renderScreen();
    expect(await screen.findByText('Wait alerts at 10 / 20 / 30 / 45 min')).toBeTruthy();
    fireEvent.click(screen.getByText('Adjust'));
    fireEvent.change(screen.getByLabelText('Wait level criticalMin'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Save levels'));
    await waitFor(() => expect(sent('PUT', '/wait-thresholds')[0]?.body).toEqual({ approachingMin: 10, exceededMin: 20, severeMin: 30, criticalMin: 50 }));
  });
});

describe('Per-customer panel', () => {
  it('picks the guest from the live queue (no raw ID box) and shows the recommendation + what the engine knows', async () => {
    renderScreen();
    expect(screen.queryByPlaceholderText(/Queue entry ID/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Done Person/ })).toBeNull();   // only active guests are offered
    await pickJessica();
    expect(screen.getByText(/Asked for Leo/)).toBeTruthy();
    expect(screen.getByText(/Last time: Mia/)).toBeTruthy();
    expect(screen.getByText('Mia is free now and does gel.')).toBeTruthy();
  });

  it('Accept sends the decision with the recommended technician and an idempotency key', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Accept'));
    await waitFor(() => expect(sent('POST', '/recommendations/r1/decision').length).toBe(1));
    const b = sent('POST', '/recommendations/r1/decision')[0].body;
    expect(b).toMatchObject({ decision: 'accepted', chosenTechnicianId: 't1' });
    expect(typeof b.idempotencyKey).toBe('string');
    expect(b.idempotencyKey.length).toBeGreaterThan(8);
    expect(await screen.findByText(/Jessica Miller is now with Mia/)).toBeTruthy();
  });

  it('Reject needs a reason AND a feedback code before anything is sent', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Reject…'));
    fireEvent.click(screen.getByText('Reject recommendation'));
    expect(await screen.findByText(/Say why you are rejecting/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reject reason'), { target: { value: 'guest asked for Leo' } });
    fireEvent.click(screen.getByText('Reject recommendation'));
    expect(await screen.findByText(/Pick what was wrong with it/)).toBeTruthy();
    expect(sent('POST', '/decision').length).toBe(0);
    fireEvent.change(screen.getByLabelText('Feedback'), { target: { value: 'customer_preference' } });
    fireEvent.click(screen.getByText('Reject recommendation'));
    await waitFor(() => expect(sent('POST', '/recommendations/r1/decision')[0]?.body).toMatchObject({ decision: 'rejected', reason: 'guest asked for Leo', feedbackCode: 'customer_preference' }));
  });

  it('Override assigns the chosen technician', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Choose someone else…'));
    fireEvent.change(screen.getByLabelText('Override technician'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'requested Leo' } });
    fireEvent.click(screen.getByText('Assign to this technician'));
    await waitFor(() => expect(sent('POST', '/recommendations/r1/decision')[0]?.body).toMatchObject({ decision: 'overridden', chosenTechnicianId: 't2', reason: 'requested Leo' }));
  });

  it('Override is hidden from roles without ai_queue_assignment.override', async () => {
    perms.deny.add('ai_queue_assignment.override');
    renderScreen(); await pickJessica();
    expect(screen.queryByText('Choose someone else…')).toBeNull();
    expect(screen.queryByText('Lock…')).toBeNull();
  });

  it('a 409 on accept says plainly who has the guest now', async () => {
    routes['POST /pos/ai-queue-assignment/recommendations/r1/decision'] = { status: 409, body: { statusCode: 409, code: 'VERSION_CONFLICT', message: 'This guest was just assigned or changed on another device.', currentTechnicianId: 't2' } };
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Accept'));
    expect(await screen.findByText(/Someone else changed Jessica Miller first — they are now with Leo/)).toBeTruthy();
  });

  it('Lock sends technicianId null ("keep unassigned") with the reason', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Lock…'));
    fireEvent.change(screen.getByLabelText('Lock technician'), { target: { value: 't3' } });          // change of mind…
    fireEvent.change(screen.getByLabelText('Lock technician'), { target: { value: '__nobody__' } });  // …back to "nobody"
    fireEvent.change(screen.getByLabelText('Lock reason'), { target: { value: 'waiting for her friend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(sent('POST', '/pos/queue/items/q1/lock')[0]?.body).toEqual({ technicianId: null, reason: 'waiting for her friend' }));
  });

  it('Lock to a technician sends that technician with optional expiry', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Lock…'));
    fireEvent.change(screen.getByLabelText('Lock technician'), { target: { value: 't2' } });
    fireEvent.change(screen.getByLabelText('Lock reason'), { target: { value: 'regular of Leo' } });
    fireEvent.change(screen.getByLabelText('Lock minutes'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
    await waitFor(() => expect(sent('POST', '/pos/queue/items/q1/lock')[0]?.body).toEqual({ technicianId: 't2', reason: 'regular of Leo', expiresInMinutes: 30 }));
    expect(await screen.findByText(/Jessica Miller is locked to Leo/)).toBeTruthy();
  });

  it('full decision history (GET entries/:id/decisions) and "what was suggested" (GET recommendations/:id)', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Full history'));
    await waitFor(() => expect(sent('GET', '/entries/q1/decisions').length).toBe(1));
    expect(await screen.findByText(/· older/)).toBeTruthy();
    fireEvent.click(screen.getAllByText('What was suggested')[0]);
    expect(await screen.findByText(/Suggested Ana at 55% confidence/)).toBeTruthy();
    expect(sent('GET', '/entries/q1/decisions').length).toBe(1);
    expect(sent('GET', '/recommendations/r0').length).toBe(1);
  });
});

describe('Per-customer panel — multi-technician visit plan (contract §7)', () => {
  const planReco = { recommendationId: 'rp1', kind: 'visit', party: null, planVersion: 'qa-plan-1', ruleVersion: 'r', recoVersion: 'v', configVersion: '3.7', generatedAt: '2026-10-07T15:00:00Z',
    visit: { queueItemId: 'q1', customerName: 'Jessica Miller', queueVersion: 4, expectedTechnicianId: null, mode: 'split', leadTechnicianId: 't1', technicianCount: 2, estimatedStartInMinutes: 0, estimatedFinishInMinutes: 45,
      singleTechnicianAlternative: null, confidence: 0.8, warnings: [], conflicts: [], requiredAction: 'assignable', lines: [
        { queueItemId: 'q1', serviceId: 's1', serviceName: 'Pedicure', category: 'Pedicure', durationMinutes: 45, sequence: 1, technicianId: 't1', technicianName: 'Mia', expectedTechnicianId: null, timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 45, confidence: 0.8, reasons: [], warnings: [], alternates: [], ineligible: [] },
        { queueItemId: 'q1', serviceId: 's2', serviceName: 'Manicure', category: 'Manicure', durationMinutes: 30, sequence: 2, technicianId: 't2', technicianName: 'Leo', expectedTechnicianId: null, timing: 'parallel', afterServiceId: null, estimatedStartInMinutes: 0, estimatedEndInMinutes: 30, confidence: 0.8, reasons: [], warnings: [], alternates: [], ineligible: [] },
      ] } };
  it('a split best match shows the visit plan instead of the one-technician recommendation, and Accept decides the plan', async () => {
    routes['GET /pos/queue/items'] = { body: { items: [{ queueItemId: 'q1', customerName: 'Jessica Miller', status: 'waiting', assignedTechnicianId: null, actualWaitMinutes: 14, bestMatchMode: 'split', bestMatchTechnicianNames: ['Mia', 'Leo'] }], pagination: {} } };
    routes['POST /pos/ai-queue-assignment/entries/q1/plan'] = { body: planReco };
    routes['POST /pos/ai-queue-assignment/plans/rp1/decision'] = { body: { decision: { id: 'dp' }, applied: true, result: null } };
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: /Jessica Miller/ }));
    const panel = await screen.findByLabelText('Visit plan for Jessica Miller');
    expect(await within(panel).findByText('Split across 2 technicians')).toBeTruthy();
    expect(screen.queryByText(/Suggested: Mia/)).toBeNull();
    fireEvent.click(within(panel).getByText('Accept plan'));
    await waitFor(() => expect(sent('POST', '/plans/rp1/decision')[0]?.body).toMatchObject({ decision: 'accepted' }));
    expect(sent('POST', '/recommendations/r1/decision').length).toBe(0);
  });

  it('a single-technician guest keeps the recommendation; "Plan by service…" opens the plan on demand', async () => {
    routes['POST /pos/ai-queue-assignment/entries/q1/plan'] = { body: planReco };
    renderScreen(); await pickJessica();
    expect(screen.queryByLabelText('Visit plan for Jessica Miller')).toBeNull();
    expect(sent('POST', '/entries/q1/plan').length).toBe(0);
    fireEvent.click(screen.getByText('Plan by service…'));
    expect(await screen.findByLabelText('Visit plan for Jessica Miller')).toBeTruthy();
    await waitFor(() => expect(sent('POST', '/entries/q1/plan').length).toBe(1));
  });
});

describe('Settings — the ONE source (salon + location, versioned)', () => {
  it('shows inherit vs override and saves a location override with the loaded version', async () => {
    renderScreen();
    const inherit = await screen.findByLabelText('Wait — approaching same as salon') as HTMLInputElement;
    expect(inherit.checked).toBe(true);                                   // branch null = inherits
    expect((screen.getByLabelText('Stuck after no change for same as salon') as HTMLInputElement).checked).toBe(false);   // branch 25 = override
    fireEvent.click(inherit);
    fireEvent.change(screen.getByLabelText('Wait — approaching'), { target: { value: '8' } });
    fireEvent.click(screen.getByText('Save for this location'));
    await waitFor(() => expect(sent('PUT', '/pos/ai-queue-assignment/settings')[0]?.body).toMatchObject({ scope: 'branch', patch: { waitApproachingMin: 8 }, expectedVersion: 7 }));
    expect(screen.getByText(/busy saturdays/)).toBeTruthy();              // the versions list
  });

  it('a 409 on save shows the plain "someone else changed these settings" message', async () => {
    routes['PUT /pos/ai-queue-assignment/settings'] = { status: 409, body: { message: 'These settings changed since you opened them. Reload and try again.' } };
    renderScreen();
    fireEvent.change(await screen.findByLabelText('Stuck after no change for'), { target: { value: '35' } });
    fireEvent.click(screen.getByText('Save for this location'));
    expect(await screen.findByText(settingsConflictMessage())).toBeTruthy();
    expect(screen.getByText('Reload')).toBeTruthy();
  });

  it('the salon kill switch asks for a reason and posts { scope: salon, reason }', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Stop auto-assign everywhere'));
    expect(await screen.findByText('Why stop auto-assign at every location of the salon?')).toBeTruthy();
    fireEvent.click(screen.getByText('Stop auto-assign'));                // a reason is required — nothing is sent
    expect(sent('POST', '/auto/kill').length).toBe(0);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'double bookings today' } });
    fireEvent.click(screen.getByText('Stop auto-assign'));
    await waitFor(() => expect(sent('POST', '/auto/kill')[0]?.body).toEqual({ scope: 'salon', reason: 'double bookings today' }));
  });
});

describe('Auto-assignment', () => {
  it('says why auto is off in one plain line', async () => {
    renderScreen();
    expect(await screen.findByTestId('auto-off-reason')).toHaveTextContent('Auto-assign is off because the salon-wide kill switch is on (“double bookings”).');
  });
});

describe('Analytics + export', () => {
  it('shows rates incl. auto-assigned, recent decisions (GET decisions) and exports CSV for permitted roles', async () => {
    renderScreen();
    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getAllByText('Auto-assigned').length).toBeGreaterThan(0);
    expect(await screen.findByText(/regular/)).toBeTruthy();
    expect(sent('GET', '/pos/ai-queue-assignment/decisions?').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Download CSV'));
    await waitFor(() => expect(sent('GET', '/export?type=decisions').length).toBe(1));
  });

  it('hides export from roles without ai_queue_assignment.export', async () => {
    perms.deny.add('ai_queue_assignment.export');
    renderScreen();
    await screen.findByText('60%');
    expect(screen.queryByText('Download CSV')).toBeNull();
  });
});


// ── Round 2: the REAL backend shapes (agents A/B/C code, not the contract draft) ─────────────────────────────────
describe('Round 2 — alerts repair offers only what the server allows (REPAIRS_BY_TYPE)', () => {
  it('a waiting_too_long alert offers call / reassign / dismiss only; reassign needs a technician and posts it', async () => {
    renderScreen();
    const a1 = await screen.findByTestId('alert-a1');
    fireEvent.click(within(a1).getByText('Repair…'));
    const sel = within(a1).getByLabelText('Repair action') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['call', 'reassign', 'dismiss']);
    fireEvent.change(sel, { target: { value: 'reassign' } });
    fireEvent.click(within(a1).getByText('Repair'));
    expect(await screen.findByText('Choose the technician to assign.')).toBeTruthy();
    expect(sent('POST', '/repair').length).toBe(0);
    fireEvent.change(within(a1).getByLabelText('Repair technician'), { target: { value: 't2' } });
    fireEvent.click(within(a1).getByText('Repair'));
    await waitFor(() => expect(sent('POST', '/alerts/a1/repair')[0]?.body).toEqual({ action: 'reassign', technicianId: 't2' }));
  });

  it('a stuck_record alert offers unassign and the other queue repairs — never an action the server refuses', async () => {
    renderScreen();
    const a4 = await screen.findByTestId('alert-a4');
    expect(within(a4).queryByText('Acknowledge')).toBeNull();                 // already acknowledged
    fireEvent.click(within(a4).getByText('Repair…'));
    const opts = [...(within(a4).getByLabelText('Repair action') as HTMLSelectElement).options].map((o) => o.value);
    expect(opts).toEqual(['unassign', 'reassign', 'call', 'start_service', 'move_to_tech_queue', 'cancel', 'dismiss']);
    expect(opts).not.toContain('reviewed_and_corrected');
  });
});

describe('Round 2 — settings: clear keys, canEditSalon, salon unkill is the owner\'s', () => {
  it('returning a location field to "same as salon" sends clear: [key], never null in the patch', async () => {
    renderScreen();
    fireEvent.click(await screen.findByLabelText('Stuck after no change for same as salon'));
    fireEvent.click(screen.getByText('Save for this location'));
    await waitFor(() => expect(sent('PUT', '/pos/ai-queue-assignment/settings').length).toBe(1));
    const b = sent('PUT', '/pos/ai-queue-assignment/settings')[0].body;
    expect(b).toEqual({ scope: 'branch', clear: ['stuckMinutes'], expectedVersion: 7, reason: null });
    expect(b).not.toHaveProperty('patch');
    await waitFor(() => expect(sent('GET', '/pos/ai-queue-assignment/settings').length).toBeGreaterThan(1));   // reloads the view
  });

  it('the salon tab is read-only when the server says canEditSalon: false', async () => {
    routes['GET /pos/ai-queue-assignment/settings'] = { body: settingsResp({ canEditSalon: false }) };
    renderScreen();
    fireEvent.click(await screen.findByRole('tab', { name: 'Salon default' }));
    expect(await screen.findByText(/Only the salon owner changes the salon-wide defaults/)).toBeTruthy();
    expect((screen.getByLabelText('Stuck after no change for') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText('Save salon defaults')).toBeNull();
  });

  it('a manager cannot turn the salon kill switch back off; the owner can (auto/unkill { scope: salon, reason })', async () => {
    routes['GET /pos/ai-queue-assignment/settings'] = { body: settingsResp({ salon: { autoKilled: true, autoKilledReason: 'double bookings' } }) };
    auth.role = 'MANAGER';
    const { unmount } = renderScreen();
    expect(await screen.findByText('Only the salon owner can turn it back off.')).toBeTruthy();
    expect(screen.queryByText('Allow auto-assign again')).toBeNull();
    unmount();
    auth.role = 'OWNER';
    renderScreen();
    fireEvent.click(await screen.findByText('Allow auto-assign again'));
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'fixed the double bookings' } });
    fireEvent.click(screen.getByText('Allow again'));
    await waitFor(() => expect(sent('POST', '/auto/unkill')[0]?.body).toEqual({ scope: 'salon', reason: 'fixed the double bookings' }));
  });
});

describe('Round 2 — panel candidates, auto-run result, analytics + usage', () => {
  it('the override list comes from the panel\'s candidates and says why one is not eligible', async () => {
    renderScreen(); await pickJessica();
    fireEvent.click(screen.getByText('Choose someone else…'));
    const opts = [...(screen.getByLabelText('Override technician') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opts).toContain('Ana — on break');
    expect(opts.indexOf('Mia')).toBeLessThan(opts.indexOf('Ana — on break'));   // eligible first
  });

  it('Run now reads { allowed, blockedBy } and says why nothing ran', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Run now'));
    expect(await screen.findByText('Auto-assign is off because the salon-wide kill switch is on.')).toBeTruthy();
  });

  it('analytics shows staff decisions, served, by-technician columns, feedback codes and AI usage', async () => {
    renderScreen();
    expect(await screen.findByText('Staff decisions')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();                                   // waits.served
    expect(screen.getByText('40 min')).toBeTruthy();                               // waits.longestMinutes
    expect(screen.getByText(/What staff said was wrong: customer preference \(2\)/i)).toBeTruthy();
    expect(screen.getByText('Chosen by staff')).toBeTruthy();
    expect(screen.getByText(/AI calls this period: 9 · 7 explanations · 21 recommendations · cost \$1\.25/)).toBeTruthy();
    expect(screen.getByText(/Alerts this period: 5 \(3 cleared on their own\)/)).toBeTruthy();
  });
});
