// ai-queue-assignment-detection.vitest.spec — BUILD_PLAN Phase 6: the ONE detection core, pure. Each detector, the
// thresholds coming from the settings (not constants), the real status vocabulary + real updated_at (audit bug 3), and
// the auto-resolve contract of a scan.
import { describe, it, expect } from 'vitest';
import {
  detectQueueFindings, classifyWait, classifyCongestion, evaluateStuck, summarizeQueue, thresholdsOf, findingKey, DEFAULT_DETECTION_THRESHOLDS,
  type DetectionEntry, type DetectionTechnician,
} from './ai-queue-assignment-detection';
import { InMemoryQueueAlertRepository } from './ai-queue-assignment-alerts.repository';

const NOW = Date.UTC(2026, 9, 7, 15, 0, 0);
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const e = (o: Partial<DetectionEntry> & { queueEntryId: string }): DetectionEntry => ({ status: 'waiting', waitMinutes: 0, assignedTechnicianId: null, isAppointment: false, updatedAt: ago(1), ...o });
const tech = (id: string, status = 'available'): DetectionTechnician => ({ technicianId: id, status });
const find = (f: ReturnType<typeof detectQueueFindings>, type: string, key?: string) => f.filter((x) => x.type === type && (!key || x.queueEntryId === key));
const T = DEFAULT_DETECTION_THRESHOLDS;

describe('wait levels + unassigned', () => {
  it('levels follow the ladder; only exceeded+ is a waiting alert, with rising severity', () => {
    expect([5, 12, 22, 33, 50].map((m) => classifyWait(m, T))).toEqual(['none', 'approaching', 'exceeded', 'severe', 'critical']);
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1'), tech('t2'), tech('t3'), tech('t4'), tech('t5')], entries: [
      e({ queueEntryId: 'q12', waitMinutes: 12, assignedTechnicianId: 't1' }), e({ queueEntryId: 'q22', waitMinutes: 22, assignedTechnicianId: 't2' }),
      e({ queueEntryId: 'q33', waitMinutes: 33, assignedTechnicianId: 't3' }), e({ queueEntryId: 'q50', waitMinutes: 50, assignedTechnicianId: 't4' })] }, T, NOW);
    expect(find(f, 'waiting_too_long').map((x) => [x.queueEntryId, x.severity])).toEqual([['q22', 'warning'], ['q33', 'high'], ['q50', 'critical']]);
  });
  it('unassigned from "approaching" on; a guest a manager locked to "nobody yet" is not nagged', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1')], entries: [
      e({ queueEntryId: 'fresh', waitMinutes: 3 }), e({ queueEntryId: 'q12', waitMinutes: 12 }), e({ queueEntryId: 'held', waitMinutes: 25, lock: { technicianId: null } })] }, T, NOW);
    expect(find(f, 'unassigned').map((x) => x.queueEntryId)).toEqual(['q12']);
    expect(find(f, 'waiting_too_long', 'held').length).toBe(1);   // still waiting long — that alert stays
  });
  it('the thresholds come from the settings: a salon at 5/8/12/15 alerts a 13-minute wait as severe', () => {
    const custom = thresholdsOf({ waitApproachingMin: 5, waitExceededMin: 8, waitSevereMin: 12, waitCriticalMin: 15 });
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1')], entries: [e({ queueEntryId: 'q', waitMinutes: 13, assignedTechnicianId: 't1' })] }, custom, NOW);
    expect(find(f, 'waiting_too_long')[0].severity).toBe('high');
    expect(find(detectQueueFindings({ branchId: 'b', technicians: [tech('t1')], entries: [e({ queueEntryId: 'q', waitMinutes: 13, assignedTechnicianId: 't1' })] }, T, NOW), 'waiting_too_long')).toEqual([]);
  });
  it('finished and in-service guests are not "waiting"', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1')], entries: [e({ queueEntryId: 'c', status: 'completed', waitMinutes: 90 }), e({ queueEntryId: 'r', status: 'removed', waitMinutes: 90 }),
      e({ queueEntryId: 's', status: 'in_service', waitMinutes: 90, assignedTechnicianId: 't1', startedAt: ago(5), expectedDurationMinutes: 30 })] }, T, NOW);
    expect(f.filter((x) => x.type === 'waiting_too_long' || x.type === 'unassigned')).toEqual([]);
  });
});

describe('stuck records — real updated_at, real statuses (audit bug 3)', () => {
  it('assigned / called / handed-off rows unchanged past the window are stuck; fresh ones are not', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1', 'busy'), tech('t2', 'busy')], entries: [
      e({ queueEntryId: 'a', status: 'assigned', assignedTechnicianId: 't1', updatedAt: ago(31) }),
      e({ queueEntryId: 'a2', status: 'assigned', assignedTechnicianId: 't2', updatedAt: ago(29) }),
      e({ queueEntryId: 'c', status: 'called', assignedTechnicianId: 't1', updatedAt: ago(61) }),
      e({ queueEntryId: 'h', status: 'moved_to_tech_queue', assignedTechnicianId: 't1', updatedAt: ago(40) }),
      e({ queueEntryId: 'w', status: 'waiting', updatedAt: ago(95), waitMinutes: 95 }),
    ] }, T, NOW);
    const st = find(f, 'stuck_record');
    expect(st.map((x) => x.queueEntryId).sort()).toEqual(['a', 'c', 'h', 'w']);
    expect(st.find((x) => x.queueEntryId === 'c')!.severity).toBe('high');   // twice the window
    expect(st.find((x) => x.queueEntryId === 'a')!.repairs).toContain('unassign');
  });
  it('the statuses the old detector looked for (service_completed / checkout_pending / seated) do not exist; the stuck window is the setting', () => {
    expect(evaluateStuck({ status: 'assigned', assignedTechnicianId: 't', updatedAt: ago(20) }, NOW, { stuckMinutes: 15 }).stuck).toBe(true);
    expect(evaluateStuck({ status: 'assigned', assignedTechnicianId: 't', updatedAt: ago(20) }, NOW, { stuckMinutes: 30 }).stuck).toBe(false);
    expect(evaluateStuck({ status: 'assigned', assignedTechnicianId: 't', updatedAt: null }, NOW, { stuckMinutes: 15 }).stuck).toBe(false);   // no stamp → no guess
  });
  it('a guest assigned to a technician who clocked out is stuck at once', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('gone', 'clocked_out')], entries: [e({ queueEntryId: 'x', status: 'assigned', assignedTechnicianId: 'gone', updatedAt: ago(1) })] }, T, NOW);
    expect(find(f, 'stuck_record', 'x')[0]).toMatchObject({ severity: 'high' });
  });
});

describe('late appointment, long service, overloaded technician', () => {
  it('an appointment whose time passed by more than the grace and has not started is late', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1')], entries: [
      e({ queueEntryId: 'late', isAppointment: true, appointmentStartAt: ago(15), assignedTechnicianId: 't1', waitMinutes: 5 }),
      e({ queueEntryId: 'ok', isAppointment: true, appointmentStartAt: ago(5), assignedTechnicianId: 't1', waitMinutes: 5 }),
      e({ queueEntryId: 'future', isAppointment: true, appointmentStartAt: new Date(NOW + 30 * 60_000).toISOString(), lateMinutes: null }),
      e({ queueEntryId: 'arrivedLate', isAppointment: true, appointmentStartAt: new Date(NOW + 1 * 60_000).toISOString(), lateMinutes: 25 }),
    ] }, thresholdsOf({ lateGraceMin: 10 }), NOW);
    expect(find(f, 'late_appointment').map((x) => [x.queueEntryId, x.severity])).toEqual([['late', 'warning'], ['arrivedLate', 'info']]);
  });
  it('a service running past expected × factor is long; twice as long again is high', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('t1', 'busy'), tech('t2', 'busy')], entries: [
      e({ queueEntryId: 'l', status: 'in_service', assignedTechnicianId: 't1', startedAt: ago(46), expectedDurationMinutes: 30 }),
      e({ queueEntryId: 'xl', status: 'in_service', assignedTechnicianId: 't2', startedAt: ago(70), expectedDurationMinutes: 30 }),
      e({ queueEntryId: 'n', status: 'in_service', assignedTechnicianId: 't2', startedAt: ago(40), expectedDurationMinutes: 30 }),
    ] }, T, NOW);
    expect(find(f, 'long_service').map((x) => [x.queueEntryId, x.severity])).toEqual([['l', 'warning'], ['xl', 'high']]);
  });
  it('three guests on one technician while another is free → overloaded (keyed by the technician)', () => {
    const f = detectQueueFindings({ branchId: 'b', technicians: [tech('busy1', 'busy'), tech('free1')], entries: [
      e({ queueEntryId: 'g1', assignedTechnicianId: 'busy1', status: 'assigned' }), e({ queueEntryId: 'g2', assignedTechnicianId: 'busy1', status: 'assigned' }),
      e({ queueEntryId: 'g3', assignedTechnicianId: 'busy1', status: 'assigned' })] }, T, NOW);
    expect(find(f, 'overloaded_technician')).toEqual([expect.objectContaining({ queueEntryId: 'busy1', technicianId: 'busy1', severity: 'warning' })]);
    const two = detectQueueFindings({ branchId: 'b', technicians: [tech('busy1', 'busy'), tech('free1')], entries: [
      e({ queueEntryId: 'g1', assignedTechnicianId: 'busy1' }), e({ queueEntryId: 'g2', assignedTechnicianId: 'busy1' })] }, T, NOW);
    expect(find(two, 'overloaded_technician')).toEqual([]);
  });
});

describe('congestion', () => {
  it('scales with the per-technician setting (defaults = the old fixed numbers)', () => {
    expect(classifyCongestion({ waitingCount: 4, longestWaitMinutes: 0, availableTechnicians: 2 }, T).level).toBe('high');   // 2 per tech
    expect(classifyCongestion({ waitingCount: 8, longestWaitMinutes: 0, availableTechnicians: 2 }, T).level).toBe('critical');
    expect(classifyCongestion({ waitingCount: 4, longestWaitMinutes: 0, availableTechnicians: 2 }, thresholdsOf({ congestionWaitingPerTech: 4 })).level).toBe('normal');
    expect(classifyCongestion({ waitingCount: 1, longestWaitMinutes: 0, availableTechnicians: 0 }, T).level).toBe('critical');
    expect(classifyCongestion({ waitingCount: 0, longestWaitMinutes: 0, availableTechnicians: 0 }, T).level).toBe('normal');
  });
  it('one congestion finding per branch, keyed by the branch; on-break and clocked-out technicians are not free', () => {
    const f = detectQueueFindings({ branchId: 'B1', technicians: [tech('t1', 'on_break'), tech('t2', 'clocked_out'), tech('t3')], entries: [
      e({ queueEntryId: 'a' }), e({ queueEntryId: 'b' }), e({ queueEntryId: 'c' })] }, T, NOW);
    expect(find(f, 'congestion')).toEqual([expect.objectContaining({ queueEntryId: 'B1', severity: 'high' })]);   // 3 per free tech → severe? 3 ≥ 1.5·2 → severe
  });
});

describe('summary', () => {
  it('counts the board the overview shows', () => {
    const s = summarizeQueue({ branchId: 'b', technicians: [tech('t1'), tech('t2', 'busy')], entries: [e({ queueEntryId: 'a', waitMinutes: 10 }), e({ queueEntryId: 'b', waitMinutes: 30, assignedTechnicianId: 't1', status: 'assigned' }),
      e({ queueEntryId: 'c', status: 'in_service', assignedTechnicianId: 't2' }), e({ queueEntryId: 'd', status: 'done' })] }, T);
    expect(s).toMatchObject({ waiting: 2, unassigned: 1, inService: 1, avgWaitMinutes: 20, longestWaitMinutes: 30, freeTechnicians: 1 });
  });
});

describe('a scan auto-resolves what cleared', () => {
  it('raise → still true (update, no duplicate) → cleared (auto-resolved with its reason)', async () => {
    const repo = new InMemoryQueueAlertRepository(); const scope = { tenantId: 'T', branchId: 'B' };
    const only = (f: ReturnType<typeof detectQueueFindings>) => f.filter((x) => x.type === 'waiting_too_long');   // this test follows one alert
    const findings1 = only(detectQueueFindings({ branchId: 'B', technicians: [tech('t1', 'busy')], entries: [e({ queueEntryId: 'q', waitMinutes: 25, assignedTechnicianId: 't1' })] }, T, NOW));
    const r1 = await repo.applyScan(scope, findings1, ago(0));
    expect(r1.raised.map((a) => a.type)).toEqual(['waiting_too_long']);
    const r2 = await repo.applyScan(scope, only(detectQueueFindings({ branchId: 'B', technicians: [tech('t1', 'busy')], entries: [e({ queueEntryId: 'q', waitMinutes: 35, assignedTechnicianId: 't1' })] }, T, NOW)), ago(0));
    expect([r2.raised.length, r2.updated, r2.escalated.length]).toEqual([0, 1, 1]);
    const r3 = await repo.applyScan(scope, only(detectQueueFindings({ branchId: 'B', technicians: [tech('t1', 'busy')], entries: [e({ queueEntryId: 'q', status: 'in_service', assignedTechnicianId: 't1' })] }, T, NOW)), ago(0));
    expect(r3.autoResolved.map((a) => [findingKey(a), a.autoResolved, a.resolution])).toEqual([['waiting_too_long:q', true, 'condition_cleared']]);
    expect(await repo.list(scope)).toEqual([]);   // resolved hidden by default (bug 9)
    expect((await repo.list(scope, { status: 'all' })).length).toBe(1);
  });
});
