// ai-scheduling-coded-text.vitest.spec.ts — Vietnamese POS §21 / §120 (Oct 27 2026): the optimizer's server-written
// English (explanation template, benefits / downsides, hard-rule violations, conflicts, find-a-time reasons, insight
// reasons) is re-coded as code + vars by the pure helpers in api-contracts. The proof that nothing is lost: rendering the
// codes with the POS's ENGLISH catalogue (apps/pos-web/src/i18n/ns/srv.en.ts) gives back exactly the server's English.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SchedRecommendation } from '@aipowersalon/api-contracts/tenant';
import { schedExplanationCoded, schedBenefitsCoded, schedViolationCoded, schedConflictCoded, schedInsightReasonCoded } from '@aipowersalon/api-contracts/tenant';
import type { CodedText } from '@aipowersalon/api-contracts';
import { templateExplanation } from './ai-scheduling-explanation';
import { buildRecommendation, simulateChange } from './ai-scheduling-recommendation';
import { checkHardConstraints } from './ai-scheduling-constraints';
import { detectConflicts } from './ai-scheduling-detection';
import { durationSuggestion, dayInsights } from './ai-scheduling-insights';

// the POS English catalogue for 'srv.' + status keys, parsed from source (no POS import from a server module)
const cat: Record<string, string> = {};
for (const f of ['srv.en.ts', 'status.en.ts']) for (const m of readFileSync(new URL(`../../../../apps/pos-web/src/i18n/ns/${f}`, import.meta.url), 'utf8').matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',/gm)) cat[m[1]] = m[2].replace(/\\'/g, "'");
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
function ref(spec: string, raw: Record<string, string>): string {
  const [key, prefix] = spec.split('#'); let vars = raw;
  if (prefix) { vars = {}; for (const [k, v] of Object.entries(raw)) if (k.startsWith(prefix + '_')) vars[k.slice(prefix.length + 1)] = v; }
  const r: Record<string, string> = {}; for (const [k, v] of Object.entries(vars)) r[k] = prefix && v.startsWith('@') ? ref(v.slice(1), vars) : v;
  if (!(key in cat)) throw new Error('missing EN key ' + key); return fill(cat[key], r);
}
function en(ct: CodedText): string {
  const raw: Record<string, string> = {}; for (const [k, v] of Object.entries(ct.vars ?? {})) if (v != null) raw[k] = String(v);
  const vars: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) vars[k] = v.startsWith('@') ? ref(v.slice(1), raw) : v;
  const key = 'srv.' + ct.code; if (!(key in cat)) throw new Error('missing EN key ' + key); return fill(cat[key], vars);
}

const M = (o: Partial<{ idleMin: number; waitMin: number; utilizationPct: number; gapCount: number; latenessRiskPct: number }>) => ({ idleMin: 60, waitMin: 20, utilizationPct: 50, gapCount: 3, latenessRiskPct: 30, ...o });
function rec(type: any, before: any, after: any, over: Partial<SchedRecommendation> = {}): SchedRecommendation {
  const sim = simulateChange(M(before), M(after));
  const built = buildRecommendation({ type, tenantId: 't', branchId: null, currentState: null, proposedState: null, hardConstraintsChecked: true, simulation: sim, versions: { forecastVersion: null, ruleVersion: 'r', engineVersion: 'e', configVersion: 1 } as any, nowMs: 0, dataQuality: over.dataQuality as any });
  return { id: 'r', branchId: null, runId: null, type: built.type as any, status: 'review_required', hardConstraintsChecked: true, violations: [], affectedAppointmentIds: [], affectedTechnicianIds: [],
    currentState: { appointmentId: 'a', date: '2026-10-20', startTime: '10:00', endTime: '11:00', technicianId: 'x', status: 'booked', version: 1, customerId: null },
    proposedState: { kind: 'reschedule', appointmentId: 'a', date: '2026-10-20', startTime: '13:00', endTime: '14:00', technicianId: 'x' },
    simulation: sim as any, expectedBenefit: built.expectedBenefit, possibleDownside: built.possibleDownside, confidence: built.confidence, dataQuality: built.dataQuality as any,
    touchesConfirmedAppointment: false, requiresCustomerApproval: false, versions: {} as any, version: 1, applyAttempt: 0, automated: false, expiresAt: null, explanation: null, explanationSource: null, proposal: null,
    decidedByUserId: null, decidedAt: null, appliedAt: null, createdAt: '', updatedAt: '', ...over } as SchedRecommendation;
}

describe('optimizer English re-coded loses nothing', () => {
  const cases: [string, SchedRecommendation][] = [
    ['move, two benefits, a downside', rec('move_appointment', {}, { idleMin: 30, waitMin: 10, utilizationPct: 45 })],
    ['other day + new technician + customer approval + partial data', rec('change_technician', {}, { gapCount: 1 }, { dataQuality: 'partial', requiresCustomerApproval: true,
      proposedState: { kind: 'reschedule', appointmentId: 'a', date: '2026-10-21', startTime: '09:30', endTime: '10:30', technicianId: 'y' } as any })],
    ['no benefit → preserve', rec('move_appointment', {}, { idleMin: 70 })],
    ['all five benefits', rec('fill_gap', {}, { idleMin: 10, waitMin: 5, utilizationPct: 80, gapCount: 0, latenessRiskPct: 10 })],
  ];
  for (const [name, r] of cases) it('explanation: ' + name, () => {
    expect(schedExplanationCoded(r).map(en).join(' ')).toBe(templateExplanation(r));
    const b = schedBenefitsCoded(r.simulation);
    expect(b.benefits.map(en)).toEqual(r.expectedBenefit);
    expect(b.downsides.map(en)).toEqual(r.possibleDownside);
  });

  it('every hard-rule violation the gate writes', () => {
    const p = { technicianId: 'x', branchId: 'b2', serviceIds: ['svcA', 'svcB'], blocks: [{ start: 600, end: 660 }], span: { start: 600, end: 660 }, requiredTechnicianId: 'z', stationId: 's1', groupSize: 9 };
    const v = checkHardConstraints(p as any, { branchHours: { start: 700, end: 1200 }, techBranchIds: ['b1'], techShifts: [], techSkills: {}, breaks: [{ start: 600, end: 610 }], timeOff: [{ start: 600, end: 700 }],
      existingAppointments: [{ range: { start: 600, end: 650 }, technicianId: 'x' }], stationCapacity: { s1: 0 }, groupCapacity: 2 } as any).violations;
    expect(v.length).toBeGreaterThan(5);
    for (const x of v) expect(en(schedViolationCoded(x as any)!), x.code).toBe(x.message);
  });
  it('every conflict the detector writes', () => {
    const c = detectConflicts([{ id: 'a', technicianId: 'x', range: { start: 600, end: 700 }, stationId: 's1' }, { id: 'b', technicianId: 'x', range: { start: 650, end: 720 }, stationId: 's1' }] as any,
      { shiftsByTech: { x: [{ start: 900, end: 1000 }] }, branchHours: { start: 800, end: 1200 }, stationCapacity: { s1: 1 } });
    expect(new Set(c.map((x) => x.type))).toEqual(new Set(['DOUBLE_BOOK', 'BEYOND_SHIFT', 'OUTSIDE_HOURS', 'STATION_OVERBOOK']));
    for (const x of c) expect(en(schedConflictCoded(x.type, x.message)!), x.type).toBe(x.message);
  });
  it('insight reasons (duration, availability open / close, staffing hours)', () => {
    const d = durationSuggestion(30, { n: 40, median: 48, p25: 40, p75: 55, stddev: 6, mean: 48 } as any)!;
    expect(en(schedInsightReasonCoded(d.reason)!)).toBe(d.reason);
    const close = dayInsights({ capacityMin: 1000, confirmedMin: 100, historyDailyMin: [100, 120], unscheduledTechnicianIds: [] }).availability!;
    expect(en(schedInsightReasonCoded(close.reason)!)).toBe(close.reason);
    const open = dayInsights({ capacityMin: 100, confirmedMin: 300, historyDailyMin: [], unscheduledTechnicianIds: ['t9'] }).availability!;
    expect(en(schedInsightReasonCoded(open.reason)!)).toBe(open.reason);
    for (const h of [1, 3]) { const s = `Schedule about ${h} more technician hour${h === 1 ? '' : 's'}.`; expect(en(schedInsightReasonCoded(s)!)).toBe(s); }
    expect(schedInsightReasonCoded('something else')).toBeNull();
  });
});
