// ai-scheduling-ops.vitest.spec — BUILD_PLAN Phase 7 (agent B): the smaller operations pieces — CSV export (formula
// injection), the technician's change list, the owner summary, the insight rules + decisions, the platform switch, the
// lazy engine, and error → HTTP mapping.
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { csvCell, toCsv, SchedExportService } from './ai-scheduling-export';
import { toTechChange, SchedTechService } from './ai-scheduling-tech';
import { SchedOwnerService, clampDays } from './ai-scheduling-owner';
import { durationSuggestion, dayInsights, SchedInsightService, type InsightStore } from './ai-scheduling-insights';
import { robustDurationStats } from './ai-scheduling-stats';
import { SchedPlatformSwitch } from './ai-scheduling-ops.platform-switch';
import { LazySchedEngine, schedOpsRun, SchedOpsError, schedSystemCtx, needPerm, unwrapRec } from './ai-scheduling-ops.common';
import { SchedOptionsBridge } from './ai-scheduling-ops.bridge';

const T = '44444444-0000-4000-8000-000000000001';
const B = '44444444-0000-4000-8000-000000000002';
const TECH = '44444444-0000-4000-8000-0000000000e1';
const OTHER = '44444444-0000-4000-8000-0000000000e2';
const user = (perms: string[], over: any = {}) => ({ tenantId: T, branchId: B, userId: '44444444-0000-4000-8000-0000000000f1', role: 'MANAGER', permissions: perms, actor: 'user' as const, ...over });

describe('export', () => {
  it('neutralises formula-leading cells and quotes per RFC 4180', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    for (const p of ['+1', '-2', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(p).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(toCsv(['h'], [['v']])).toBe('h\r\nv\r\n');
  });
  it('validates kind / range, needs export, scopes to the session location', async () => {
    const read = { rows: vi.fn(async () => ({ header: ['a'], rows: [['=1']] })) };
    const svc = new SchedExportService(read, () => Date.parse('2026-10-08T00:00:00Z'));
    const out = await svc.export(user(['ai_scheduling.export']), { kind: 'runs' });
    expect(out.csv).toBe("a\r\n'=1\r\n");
    expect(out.filename).toBe('ai-scheduling-runs-2026-09-09-to-2026-10-08.csv');
    expect(read.rows).toHaveBeenCalledWith('runs', T, B, '2026-09-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z', 10000);
    await expect(svc.export(user(['ai_scheduling.export']), { kind: 'customers' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.export(user(['ai_scheduling.view']), { kind: 'runs' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.export(user(['ai_scheduling.export']), { kind: 'runs', from: '2026-10-09', to: '2026-10-01' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('technician changes', () => {
  const row = (current: any, proposed: any) => ({ id: 'r', status: 'review_required' as const, type: 'change_technician' as const, current, proposed, updatedAt: 'u', customerFirstName: 'Ann' });
  it('moves to me / away from me from MY point of view', () => {
    const toMe = toTechChange(row({ appointmentId: 'a', date: '2026-10-20', startTime: '10:00', technicianId: OTHER }, { appointmentId: 'a', date: '2026-10-20', startTime: '10:00', technicianId: TECH }), TECH);
    expect(toMe).toMatchObject({ movesToMe: true, movesAwayFromMe: false, appointmentId: 'a', from: { date: '2026-10-20', startTime: '10:00' }, customerFirstName: 'Ann' });
    const away = toTechChange(row({ technicianId: TECH, date: 'd', startTime: '1' }, { technicianId: OTHER, date: 'd', startTime: '2' }), TECH);
    expect(away).toMatchObject({ movesToMe: false, movesAwayFromMe: true });
    const sameTech = toTechChange(row({ technicianId: TECH, date: 'd', startTime: '1' }, { technicianId: TECH, date: 'd', startTime: '2' }), TECH);
    expect(sameTech).toMatchObject({ movesToMe: false, movesAwayFromMe: false });
  });
  it('resolves the technician from the session; none linked → 403; date default = branch business day', async () => {
    const read = { technicianFor: vi.fn(async () => TECH), branchTz: vi.fn(async () => 'America/New_York'), changes: vi.fn(async () => []) };
    const svc = new SchedTechService(read, () => Date.parse('2026-10-09T02:00:00Z'));   // 22:00 Oct 8 in New York
    await svc.changes(user(['ai_scheduling.view_own'], { role: 'TECHNICIAN' }));
    expect(read.changes).toHaveBeenCalledWith(T, TECH, '2026-10-08');
    read.technicianFor.mockResolvedValueOnce(null as any);
    await expect(svc.changes(user(['ai_scheduling.view_own']))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.changes(user([]))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.changes(user(['ai_scheduling.view_own']), '10/08')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('owner summary', () => {
  it('clamps days, needs owner.dashboard.view', async () => {
    expect(clampDays(undefined)).toBe(7); expect(clampDays(400)).toBe(90); expect(clampDays(-3)).toBe(7);
    const read = { branches: vi.fn(async () => []) };
    const svc = new SchedOwnerService(read, () => Date.parse('2026-10-08T00:00:00Z'));
    expect(await svc.summary(user(['owner.dashboard.view'], { role: 'OWNER' }), '30')).toMatchObject({ days: 30, branches: [] });
    expect(read.branches).toHaveBeenCalledWith(T, '2026-09-08T00:00:00.000Z');
    await expect(svc.summary(user(['ai_scheduling.view']), '7')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('insights', () => {
  const stats = (vals: number[]) => robustDurationStats(vals);
  it('a duration suggestion needs ≥ 10 samples and a gap ≥ max(5 min, 15 %)', () => {
    expect(durationSuggestion(30, stats(Array(9).fill(45)))).toBeNull();                  // 9 samples
    expect(durationSuggestion(30, stats(Array(10).fill(45)))).toMatchObject({ action: 'increase', suggestedMin: 45 });
    expect(durationSuggestion(30, stats(Array(10).fill(34)))).toBeNull();                 // 4 min < 5
    expect(durationSuggestion(60, stats(Array(10).fill(52)))).toBeNull();                 // 8 min < 9 (15 %)
    expect(durationSuggestion(60, stats(Array(10).fill(50)))).toMatchObject({ action: 'decrease', suggestedMin: 50 });
    expect(durationSuggestion(null, stats(Array(20).fill(50)))).toBeNull();
  });
  it('day insights: understaffed → staffing; low projected utilization → close; overbooked with a free tech → open', () => {
    expect(dayInsights({ capacityMin: 480, confirmedMin: 700, historyDailyMin: [], unscheduledTechnicianIds: ['x'] })).toMatchObject({ staffing: { state: 'severely_understaffed' }, availability: { direction: 'open', technicianId: 'x' } });
    expect(dayInsights({ capacityMin: 960, confirmedMin: 60, historyDailyMin: [120, 180], unscheduledTechnicianIds: [] })).toMatchObject({ staffing: null, availability: { direction: 'close' } });
    expect(dayInsights({ capacityMin: 960, confirmedMin: 60, historyDailyMin: [], unscheduledTechnicianIds: [] }).availability).toBeNull();   // no forecast → no close
    expect(dayInsights({ capacityMin: 480, confirmedMin: 300, historyDailyMin: [300, 320], unscheduledTechnicianIds: [] })).toEqual({ staffing: null, availability: null });
  });
  const store = (over: Partial<InsightStore> = {}): InsightStore => ({
    list: async () => [], get: async () => ({ kind: 'duration', id: 'i', branchId: B, serviceId: 's', technicianId: null, action: 'increase', currentMin: 30, suggestedMin: 45, sampleSize: 12, reason: null, confidence: 0.7, status: 'review_required', version: 3, createdAt: '' }),
    decide: async () => ({ kind: 'duration', id: 'i', branchId: B, serviceId: 's', technicianId: null, action: 'increase', currentMin: 30, suggestedMin: 45, sampleSize: 12, reason: null, confidence: 0.7, status: 'approved', version: 4, createdAt: '' }),
    supersedeApprovedDuration: vi.fn(async () => undefined), durationSamples: async () => [], currentDurations: async () => ({ catalog: {}, approved: [] }), replaceStats: async () => undefined,
    upsertDuration: async () => null, branches: async () => [], dayInputs: async () => ({ capacityMin: 0, confirmedMin: 0, historyDailyMin: [], unscheduledTechnicianIds: [] }), upsertStaffing: async () => null, upsertAvailability: async () => null, ...over,
  });
  const ID = '44444444-0000-4000-8000-0000000000aa';
  it('approve needs ai_scheduling.approve + expectedVersion; approving a duration retires the old approved one; event emitted', async () => {
    const s = store(); const events = { emit: vi.fn(async () => undefined) };
    const svc = new SchedInsightService(s, events);
    await expect(svc.decide(user(['ai_scheduling.view']), 'duration', ID, true, { expectedVersion: 3 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.decide(user(['ai_scheduling.approve']), 'duration', ID, true, {})).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(svc.decide(user(['ai_scheduling.approve']), 'nope', ID, true, { expectedVersion: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const out = await svc.decide(user(['ai_scheduling.approve']), 'duration', ID, true, { expectedVersion: 3 });
    expect(out.status).toBe('approved');
    expect(s.supersedeApprovedDuration).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(expect.anything(), 'schedule.insight_decided', expect.objectContaining({ type: 'schedule_insight', id: 'i' }), expect.objectContaining({ approved: true, kind: 'duration' }));
  });
  it('CAS lost → VERSION_CONFLICT; already decided → INVALID_STATE; another location → NOT_FOUND', async () => {
    const svc = new SchedInsightService(store({ decide: async () => null }), null);
    await expect(svc.decide(user(['ai_scheduling.approve']), 'duration', ID, false, { expectedVersion: 2 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const decided = new SchedInsightService(store({ get: async () => ({ kind: 'staffing', id: 'i', branchId: B, date: null, startTime: null, endTime: null, state: 'x', missingMinutes: 1, missingSkills: [], recommendedAction: null, confidence: 1, status: 'rejected', version: 2, createdAt: '' }) }), null);
    await expect(decided.decide(user(['ai_scheduling.approve']), 'staffing', ID, true, { expectedVersion: 2 })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const elsewhere = new SchedInsightService(store({ get: async () => ({ kind: 'availability', id: 'i', branchId: OTHER, date: null, startTime: null, endTime: null, technicianId: null, serviceId: null, direction: 'open', reason: null, confidence: 1, status: 'review_required', version: 1, createdAt: '' }) }), null);
    await expect(elsewhere.decide(user(['ai_scheduling.approve']), 'availability', ID, true, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('generateDurations groups by location × service AND × technician, uses the hierarchy for "current", writes stats', async () => {
    const samples = [...Array(12).fill(0).map(() => ({ branchId: B, serviceId: 's1', technicianId: TECH, minutes: 50 }))];
    const upserts: any[] = []; let stats: any[] = [];
    const s = store({ durationSamples: async () => samples, currentDurations: async () => ({ catalog: { s1: 30 }, approved: [{ branchId: B, serviceId: 's1', technicianId: TECH, minutes: 48 }] }),
      upsertDuration: async (_t, r) => { upserts.push(r); return 'new-id'; }, replaceStats: async (_t, rows) => { stats = rows; } });
    const events = { emit: vi.fn(async () => undefined) };
    const out = await new SchedInsightService(s, events).generateDurations(schedSystemCtx(T, null, 'test'));
    expect(stats.map((x) => x.technicianId)).toEqual([null, TECH]);
    // location × service: catalog 30 vs median 50 → suggest; × technician: approved 48 vs 50 → no suggestion
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ technicianId: null, currentMin: 30, suggestedMin: 50, sampleSize: 12 });
    expect(out).toEqual({ keys: 2, suggestions: 1 });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });
  it('refresh queues the job when a queue is wired', async () => {
    const q = { enqueueRefresh: vi.fn(async () => ({ queued: true })) };
    expect(await new SchedInsightService(store(), null, q).refresh(user(['ai_scheduling.approve']))).toEqual({ queued: true });
    expect(q.enqueueRefresh).toHaveBeenCalledWith(T);
  });
});

describe('platform switch', () => {
  it('reads both switches, caches, keeps the last value on a read failure', async () => {
    let n = 0; let t = 0;
    const reader = { read: vi.fn(async () => { n++; if (n === 3) throw new Error('db'); return { optimizerKilled: n >= 2, autoActionsDisabled: false }; }) };
    const sw = new SchedPlatformSwitch(reader, 1000, () => t);
    expect(await sw.isKilled()).toBe(false);
    expect(await sw.isKilled()).toBe(false);           // cached
    t = 2000; expect(await sw.isKilled()).toBe(true);
    t = 4000; expect(await sw.isKilled()).toBe(true);  // read failed → last known
    expect(await sw.automationBlocked()).toEqual({ blocked: true, by: 'optimizer_platform_switch' });
    const ai = new SchedPlatformSwitch({ read: async () => ({ optimizerKilled: false, autoActionsDisabled: true }) });
    expect(await ai.isKilled()).toBe(false);
    expect(await ai.automationBlocked()).toEqual({ blocked: true, by: 'ai_auto_actions_disabled' });
  });
  it('a switch that was NEVER read fails closed (Scheduling Optimizer guide): a cold process with an unreadable row is stopped, not running', async () => {
    let up = false; let t = 0;
    const sw = new SchedPlatformSwitch({ read: async () => { if (!up) throw new Error('db down'); return { optimizerKilled: false, autoActionsDisabled: false }; } }, 1000, () => t);
    expect(await sw.isKilled()).toBe(true);
    expect(await sw.automationBlocked()).toEqual({ blocked: true, by: 'optimizer_platform_switch' });
    expect(await sw.readable()).toBe(false);
    up = true; t = 5000;
    expect(await sw.isKilled()).toBe(false);
    expect(await sw.readable()).toBe(true);
  });
});

describe('common', () => {
  it('LazySchedEngine resolves the engine once, on first use', async () => {
    const engine = { findOptions: vi.fn(async () => ({ options: [], forecastAvailable: false, hold: null })) };
    const ref = { get: vi.fn(() => engine) };
    const lazy = new LazySchedEngine(ref as any, 'TOKEN');
    expect(ref.get).not.toHaveBeenCalled();
    await lazy.findOptions(user([]), { date: '2026-10-08', serviceIds: [] });
    await lazy.findOptions(user([]), { date: '2026-10-08', serviceIds: [] });
    expect(ref.get).toHaveBeenCalledTimes(1);
    expect(ref.get).toHaveBeenCalledWith('TOKEN', { strict: false });
  });
  it('schedSystemCtx goes through systemContext (SYSTEM role, system:<actor>, only the given permissions)', () => {
    expect(schedSystemCtx(T, B, 'jobs', ['ai_scheduling.view'])).toEqual({ tenantId: T, branchId: B, userId: 'system:jobs', role: 'SYSTEM', permissions: ['ai_scheduling.view'], actor: 'system' });
    expect(schedSystemCtx(T, '', 'jobs').branchId).toBeNull();
  });
  it('needPerm: system actors only with the permission their job was given', () => {
    expect(() => needPerm(schedSystemCtx(T, null, 'jobs', ['ai_scheduling.view']), 'ai_scheduling.view')).not.toThrow();
    expect(() => needPerm(schedSystemCtx(T, null, 'jobs', []), 'ai_scheduling.view')).toThrow(SchedOpsError);
  });
  it('schedOpsRun maps SchedOpsError and A\'s SchedError (by shape) to HTTP with the code', async () => {
    const e1 = await schedOpsRun(async () => { throw new SchedOpsError('VERSION_CONFLICT', 'x', { currentVersion: 4 }); }).catch((e) => e);
    expect(e1).toBeInstanceOf(HttpException); expect(e1.getStatus()).toBe(409); expect(e1.getResponse()).toMatchObject({ code: 'VERSION_CONFLICT', currentVersion: 4 });
    const a = Object.assign(new Error('m'), { name: 'SchedError', status: 422, code: 'HARD_CONSTRAINT_VIOLATION', extra: { violations: [] } });
    const e2 = await schedOpsRun(async () => { throw a; }).catch((e) => e);
    expect(e2.getStatus()).toBe(422); expect(e2.getResponse()).toMatchObject({ code: 'HARD_CONSTRAINT_VIOLATION', violations: [] });
  });
  it('unwrapRec reads both a bare recommendation and an envelope', () => {
    expect(unwrapRec({ recommendation: { id: 'x' } })?.id).toBe('x');
    expect(unwrapRec({ id: 'y' })?.id).toBe('y');
    expect(unwrapRec(null)).toBeNull();
  });
  it('the options bridge refuses until bound, then delegates', async () => {
    const b = new SchedOptionsBridge();
    expect(b.bound()).toBe(false);
    await expect(b.findOptions(user([]), { date: 'd', serviceIds: [] })).rejects.toThrow('SCHED_OPTIONS_NOT_BOUND');
    const e = { findOptions: vi.fn(async () => ({ options: [], forecastAvailable: true, hold: null })) };
    b.bind(e); expect(b.bound()).toBe(true);
    expect(await b.findOptions(user([]), { date: 'd', serviceIds: [] })).toMatchObject({ forecastAvailable: true });
  });
});
