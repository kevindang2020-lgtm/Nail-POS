// POSAIQueueAssignmentScreen.vi.test — English + Vietnamese POS mandate (WP-C3): AI Queue Assignment (overview, live queue,
// rotation, alerts, settings cards) reads in Vietnamese. Same mocked API as POSAIQueueAssignmentScreen.test.tsx.
// POSAIQueueAssignmentScreen.test.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment → complete). Tests go through the REAL
// api client with a routed fetch, so a wrong path, verb or body fails here (the old test mocked the client and never
// noticed that GET /rotation-policy answered a bare string — audit bug 7).
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const perms = { deny: new Set<string>() };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));
const auth = { role: 'OWNER' as string | null };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: auth.role ? { role: auth.role } : null }) }));

import { POSAIQueueAssignmentScreen } from './POSAIQueueAssignmentScreen';

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
const renderScreen = () => render(<MemoryRouter><POSAIQueueAssignmentScreen /></MemoryRouter>);

beforeEach(() => { perms.deny = new Set(); auth.role = 'OWNER'; routes = defaults(); install(); });

afterEach(async () => { await setLanguage('en'); });

describe('POSAIQueueAssignmentScreen in Vietnamese', () => {
  it('the overview and its cards read in Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = renderScreen();
    await screen.findByText('Chưa phân công');
    await new Promise((r) => setTimeout(r, 50));
    for (const en of ['Unassigned', 'Traditional weighted rotation (recommended)', 'VIP guests']) expect(screen.queryByText(en), en).toBeNull();
    // fixture data: technician / guest names, notes the staff typed, and the server's own alert reason sentences (English
    // from the API — reported, not POS strings)
    const DATA = ['Leo', 'Ana', 'Jessica Miller', 'busy saturdays', 'guest asked for Leo', 'regular', 'Waiting 35 min', 'Assigned with no change for 41 min'];
    expect(leftoverEnglish(container, DATA).join(' | ')).toBe('');
  });
});

// Vietnamese POS leftover (Oct 27 2026): alert reasons are server text — worded in Vietnamese from reasonCoded (or re-coded
// from the stored English with the same helper); a reason in another shape is shown as stored.
describe('AI queue alert reasons in Vietnamese', () => {
  it('"Waiting 35 min (severe)" reads in Vietnamese; an unknown shape stays as stored', async () => {
    routes['GET /pos/ai-queue-assignment/alerts'] = { body: [
      alertRow({ id: 'a1', reason: 'Waiting 35 min (severe)', reasonCoded: { code: 'AIQ_ALERT.WAITING', vars: { minutes: 35, level: '@srv.AIQ_LEVEL.severe' } } }),
      alertRow({ id: 'a5', queueEntryId: 'q5', type: 'overloaded_technician', reason: '4 guests are waiting for one technician while 2 technicians are free' }),   // older server: no reasonCoded
      alertRow({ id: 'a6', queueEntryId: 'q6', type: 'stuck_record', reason: 'Assigned with no change for 41 min' }),
    ] };
    await setLanguage('vi');
    renderScreen();
    expect(await screen.findByText('Đã chờ 35 phút (nghiêm trọng)')).toBeTruthy();
    expect(screen.getByText('4 khách đang chờ một thợ trong khi có 2 thợ đang rảnh')).toBeTruthy();
    expect(screen.getByText('Assigned with no change for 41 min')).toBeTruthy();
    expect(screen.queryByText('Waiting 35 min (severe)')).toBeNull();
  });
});
