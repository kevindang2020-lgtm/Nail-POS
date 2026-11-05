// turn-fairness.ts — PURE Fair Opportunity analytics over the append-only turn history (mandate §53–56, §106–113, §191).
//
// Methodology (documented on the dashboard and in docs/analytics/technician-performance.md):
//   • Eligible ready minutes — the time a technician spent READY in the rotation, replayed from each event's
//     status_after (an open READY interval ends at `nowMs` or the end of the range).
//   • Opportunity — every SHARED walk-in assignment (assignment_kind walk_in_shared, not corrected) with units > 0 is one
//     opportunity worth its turn units; its POOL is the technicians who were eligible and ready for it at that moment
//     (recorded on the ASSIGN event by the engine — skill pools are therefore respected, §54).
//   • Expected Opportunity — each pool member is expected units / |pool| of that opportunity (equal access among the
//     technicians who could actually take it). Summed per technician.
//   • Actual — the shared units the technician actually received (minus corrections) plus manager turn adjustments.
//   • Fairness Gap = Actual − Expected. Label (§56, never "unfair"): Within Fair Range when |gap| ≤ max(fairRangeUnits,
//     expected × fairRangePercent %), otherwise Below / Above Expected Opportunity.
// This is an operational diagnostic, not payroll (§113), and not the live algorithm (§53).

export interface TurnEventLike {
  id: string; technicianId: string; eventType: string; statusAfter: string | null; occurredAt: string; turnUnits: number; turnUnitsDelta: number;
  assignmentKind: string | null; assignmentSource: string | null; assignmentRef: string | null; reasonCode: string | null; metadata?: Record<string, unknown> | null;
  businessDate?: string;
}
export interface FairnessRow {
  technicianId: string; name: string | null;
  readyMinutes: number; eligibleWorkingMinutes: number; eligibleHours: number;
  actualUnits: number; expectedUnits: number; gapUnits: number; indicator: 'WITHIN_FAIR_RANGE' | 'BELOW_EXPECTED_OPPORTUNITY' | 'ABOVE_EXPECTED_OPPORTUNITY';
  indicatorLabel: string;
  creditedUnits: number; adjustmentUnits: number;
  walkIns: number; requestedWalkIns: number; firstAvailableWalkIns: number; appointments: number;
  automaticAssignments: number; manualAssignments: number; overrides: number;
  skips: number; skipsByReason: Record<string, number>; voluntaryDeclines: number;
  averageReadyWaitMinutes: number | null; opportunityRatePerReadyHour: number | null;
}
export interface FairnessReport {
  rows: FairnessRow[];
  team: { opportunities: number; opportunityUnits: number; automaticRecommendations: number; automaticAssignments: number; confirmedRecommendations: number;
    manualAssignments: number; overrides: number; overrideRate: number | null; skipsByReason: Record<string, number> };
  methodology: string;
}

const READY_LIKE = new Set(['READY']);
const WORKING = new Set(['READY', 'ASSIGNED', 'SERVING']);

function intervalsFor(evs: TurnEventLike[], inSet: Set<string>, startMs: number, endMs: number): number {
  let minutes = 0; let openAt: number | null = null;
  for (const e of evs) {
    const t = Date.parse(e.occurredAt); if (!Number.isFinite(t)) continue;
    const on = !!e.statusAfter && inSet.has(e.statusAfter);
    if (on && openAt === null) openAt = t;
    else if (!on && openAt !== null) { minutes += Math.max(0, (Math.min(t, endMs) - Math.max(openAt, startMs)) / 60000); openAt = null; }
  }
  if (openAt !== null) minutes += Math.max(0, (endMs - Math.max(openAt, startMs)) / 60000);
  return Math.round(minutes);
}

export function computeFairness(events: TurnEventLike[], names: Record<string, string | null>, range: { startMs: number; endMs: number },
  opts: { fairRangeUnits: number; fairRangePercent: number }): FairnessReport {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id));
  const byTech = new Map<string, TurnEventLike[]>();
  for (const e of sorted) { if (!byTech.has(e.technicianId)) byTech.set(e.technicianId, []); byTech.get(e.technicianId)!.push(e); }
  const corrected = new Set(sorted.filter((e) => e.eventType === 'CORRECTION' || e.eventType === 'DECLINE' || e.eventType === 'OFFER_TIMEOUT').map((e) => e.assignmentRef).filter(Boolean) as string[]);
  const assigns = sorted.filter((e) => (e.eventType === 'ASSIGN' || e.eventType === 'MANUAL_ASSIGN') && !corrected.has(e.id));
  const expected = new Map<string, number>();
  let opportunities = 0; let opportunityUnits = 0;
  for (const a of assigns) {
    if (a.assignmentKind !== 'walk_in_shared' || a.turnUnits <= 0) continue;
    const pool = Array.isArray(a.metadata?.eligiblePool) ? [...new Set((a.metadata!.eligiblePool as unknown[]).map(String))] : [];
    if (!pool.includes(a.technicianId)) pool.push(a.technicianId);
    opportunities++; opportunityUnits += a.turnUnits;
    for (const t of pool) expected.set(t, (expected.get(t) ?? 0) + a.turnUnits / pool.length);
    for (const t of pool) if (!byTech.has(t)) byTech.set(t, []);
  }
  const teamSkips: Record<string, number> = {};
  const rows: FairnessRow[] = [...byTech.keys()].sort().map((tid) => {
    const evs = byTech.get(tid)!;
    const readyMinutes = intervalsFor(evs, READY_LIKE, range.startMs, range.endMs);
    const eligibleWorkingMinutes = intervalsFor(evs, WORKING, range.startMs, range.endMs);
    const mine = assigns.filter((a) => a.technicianId === tid);
    const shared = mine.filter((a) => a.assignmentKind === 'walk_in_shared').reduce((s, a) => s + a.turnUnits, 0);
    const adjustmentUnits = evs.filter((e) => e.eventType === 'ADJUST').reduce((s, e) => s + e.turnUnitsDelta, 0);
    const creditedUnits = evs.filter((e) => e.eventType === 'TURN_CREDIT' || e.eventType === 'ADJUST').reduce((s, e) => s + e.turnUnitsDelta, 0);
    const actualUnits = shared + adjustmentUnits;
    const exp = Math.round(expected.get(tid) ?? 0);
    const gap = actualUnits - exp;
    const band = Math.max(opts.fairRangeUnits, Math.round(exp * opts.fairRangePercent / 100));
    const indicator = Math.abs(gap) <= band ? 'WITHIN_FAIR_RANGE' : gap < 0 ? 'BELOW_EXPECTED_OPPORTUNITY' : 'ABOVE_EXPECTED_OPPORTUNITY';
    const skipsByReason: Record<string, number> = {};
    for (const e of evs.filter((x) => x.eventType === 'SKIP')) { const r = e.reasonCode ?? 'UNSPECIFIED'; skipsByReason[r] = (skipsByReason[r] ?? 0) + 1; teamSkips[r] = (teamSkips[r] ?? 0) + 1; }
    const waits = mine.map((a) => Number(a.metadata?.readyWaitMinutes)).filter((n) => Number.isFinite(n) && n >= 0);
    const walkIns = mine.filter((a) => a.assignmentKind === 'walk_in_shared' || a.assignmentKind === 'walk_in_requested');
    const sharedCount = mine.filter((a) => a.assignmentKind === 'walk_in_shared').length;
    return {
      technicianId: tid, name: names[tid] ?? null, readyMinutes, eligibleWorkingMinutes, eligibleHours: Math.round(eligibleWorkingMinutes / 6) / 10,
      actualUnits, expectedUnits: exp, gapUnits: gap, indicator, indicatorLabel: indicatorLabel(indicator, gap),
      creditedUnits, adjustmentUnits,
      walkIns: walkIns.length, requestedWalkIns: mine.filter((a) => a.assignmentKind === 'walk_in_requested').length, firstAvailableWalkIns: sharedCount,
      appointments: mine.filter((a) => a.assignmentKind === 'appointment_any' || a.assignmentKind === 'appointment_requested').length,
      automaticAssignments: mine.filter((a) => a.assignmentSource === 'auto_assign').length,
      manualAssignments: mine.filter((a) => a.assignmentSource !== 'auto_assign').length,
      overrides: mine.filter((a) => a.eventType === 'MANUAL_ASSIGN').length,
      skips: evs.filter((e) => e.eventType === 'SKIP').length, skipsByReason,
      voluntaryDeclines: evs.filter((e) => e.eventType === 'DECLINE' && e.metadata?.penalized === true).length,
      averageReadyWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      opportunityRatePerReadyHour: readyMinutes > 0 ? Math.round((sharedCount / (readyMinutes / 60)) * 100) / 100 : null,
    };
  });
  const auto = assigns.filter((a) => a.assignmentSource === 'auto_assign').length;
  const confirmed = assigns.filter((a) => a.assignmentSource === 'ai_suggestion' && a.eventType === 'ASSIGN').length;
  const overrides = assigns.filter((a) => a.eventType === 'MANUAL_ASSIGN').length;
  const recommendations = auto + confirmed + overrides;
  return {
    rows,
    team: { opportunities, opportunityUnits, automaticRecommendations: recommendations, automaticAssignments: auto, confirmedRecommendations: confirmed,
      manualAssignments: assigns.filter((a) => a.assignmentSource !== 'auto_assign').length, overrides,
      overrideRate: recommendations ? Math.round((overrides / recommendations) * 1000) / 10 : null, skipsByReason: teamSkips },
    methodology: 'Expected opportunity = each shared walk-in’s turn units divided equally among the technicians who were eligible and ready for it. Actual = shared turn units received + manager turn adjustments. Gap = actual − expected. Ready time is replayed from the turn history.',
  };
}

export function indicatorLabel(indicator: FairnessRow['indicator'], gapUnits: number): string {
  const amt = (Math.abs(gapUnits) / 100).toFixed(1);
  if (indicator === 'WITHIN_FAIR_RANGE') return 'Within Fair Range';
  return indicator === 'BELOW_EXPECTED_OPPORTUNITY' ? `${amt} below expected opportunity` : `${amt} above expected opportunity`;
}

/** §137: one technician's day, reconstructed from history in sequence — the dispute view. */
export function explainTimeline(events: (TurnEventLike & { sequenceNumber: number; reasonText?: string | null; recommendedTechnicianId?: string | null })[], names: Record<string, string | null>): { at: string; sequence: number; text: string }[] {
  const n = (id: string | null | undefined) => (id && names[id]) || 'Technician';
  return [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber).map((e) => {
    const who = n(e.technicianId); let text: string;
    switch (e.eventType) {
      case 'JOIN': text = `${who} joined the rotation`; break;
      case 'READY': text = `${who} ready`; break;
      case 'ASSIGN': text = `${who} assigned (${(e.turnUnits / 100).toFixed(2)} turn${e.assignmentKind ? `, ${e.assignmentKind.replace(/_/g, ' ')}` : ''})`; break;
      case 'MANUAL_ASSIGN': text = `${who} assigned by staff instead of ${n(e.recommendedTechnicianId)}${e.reasonCode ? ` — ${e.reasonCode.replace(/_/g, ' ').toLowerCase()}` : ''}`; break;
      case 'START': text = `${who} started service`; break;
      case 'COMPLETE': text = `${who} completed service`; break;
      case 'TURN_CREDIT': text = `${who} credited ${(e.turnUnitsDelta / 100).toFixed(2)} turn`; break;
      case 'SKIP': text = `${who} skipped — ${(e.reasonCode ?? '').replace(/_/g, ' ').toLowerCase()}; position preserved`; break;
      case 'HOLD': text = `${who} put on hold${e.reasonCode ? ` (${e.reasonCode.replace(/_/g, ' ').toLowerCase()})` : ''}`; break;
      case 'RELEASE': text = `${who} released from hold`; break;
      case 'BREAK_START': text = `${who} started a break`; break;
      case 'BREAK_END': text = `${who} back from break`; break;
      case 'DECLINE': text = `${who} declined${e.reasonCode ? ` (${e.reasonCode.replace(/_/g, ' ').toLowerCase()})` : ''}`; break;
      case 'CUSTOMER_DECLINED': text = `Guest declined ${who}; position kept`; break;
      case 'OFFER_TIMEOUT': text = `${who}'s offer timed out`; break;
      case 'REORDER': text = `${who} moved in the rotation by a manager${e.reasonText ? ` — ${e.reasonText}` : ''}`; break;
      case 'ADJUST': text = `${who} turn adjusted ${e.turnUnitsDelta > 0 ? '+' : ''}${(e.turnUnitsDelta / 100).toFixed(2)}${e.reasonText ? ` — ${e.reasonText}` : ''}`; break;
      case 'CORRECTION': text = `${who} assignment corrected (turn returned)`; break;
      case 'CLOCK_OUT': text = `${who} clocked out`; break;
      case 'DAY_CLOSE': text = `Day closed for ${who}`; break;
      default: text = `${who} ${e.eventType.toLowerCase()}`;
    }
    return { at: e.occurredAt, sequence: e.sequenceNumber, text };
  });
}
