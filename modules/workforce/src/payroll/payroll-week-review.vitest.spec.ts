// payroll-week-review.vitest.spec.ts — 200-technician mandate §66/§67 (M5 pilot, Oct 24 2026), the PURE pieces of the
// owner's review of a large week: which statements need a look (and why), the search / branch / exceptions-only filter,
// and the query string. No database.
import { describe, it, expect } from 'vitest';
import { statementExceptions, matchesWeekFilter, weekFilterFromQuery, STATEMENT_EXCEPTION_TEXT } from './payroll-paycheck';
import { evaluateValidation, type ValidationFacts } from './payroll-workflow';

const base = { technicianId: 't1', reviewRequired: false, planIssues: 0, bonusCents: 0, positiveAdjustmentsCents: 0, deductionsCents: 0 };

describe('statementExceptions (§67)', () => {
  it('a clean statement has none', () => {
    expect(statementExceptions(base, [])).toEqual([]);
  });
  it('its own figures: a negative payable, a split that does not add up, a manual bonus / adjustment / deduction', () => {
    expect(statementExceptions({ ...base, reviewRequired: true }, []).map((e) => e.code)).toEqual(['NEGATIVE_PAYABLE']);
    expect(statementExceptions({ ...base, planIssues: 1 }, []).map((e) => e.code)).toEqual(['PAYOUT_SPLIT_MISMATCH']);
    for (const k of ['bonusCents', 'positiveAdjustmentsCents', 'deductionsCents'] as const) expect(statementExceptions({ ...base, [k]: k === 'deductionsCents' ? 1000 : 5000 }, []).map((e) => e.code)).toEqual(['MANUAL_ADJUSTMENT']);
  });
  it('the week\'s validation names the technician: missing clock-out (hourly or not), a pending adjustment, a deduction over the earnings', () => {
    const issues = [
      { code: 'OPEN_TIME_ENTRY_INFO', technicianIds: ['t1', 't2'] }, { code: 'PENDING_ADJUSTMENTS', technicianIds: ['t1'] },
      { code: 'DEDUCTION_EXCEEDS_EARNINGS', technicianIds: ['t3'] }, { code: 'UNALLOCATED_TIP', technicianIds: [] }, { code: 'LEGACY_RULE_PROVENANCE' },
    ];
    expect(statementExceptions(base, issues).map((e) => e.code)).toEqual(['MISSING_CLOCK_OUT', 'PENDING_ADJUSTMENT']);
    expect(statementExceptions({ ...base, technicianId: 't3' }, issues).map((e) => e.code)).toEqual(['DEDUCTION_EXCEEDS_EARNINGS']);
    expect(statementExceptions({ ...base, technicianId: 't9' }, issues)).toEqual([]);   // a period-level issue names nobody
  });
  it('each code once, in a stable order, with the owner-facing text', () => {
    const out = statementExceptions({ ...base, reviewRequired: true, bonusCents: 100 }, [{ code: 'NEGATIVE_NET_PAY', technicianIds: ['t1'] }, { code: 'OPEN_TIME_ENTRY', technicianIds: ['t1'] }]);
    expect(out.map((e) => e.code)).toEqual(['NEGATIVE_PAYABLE', 'MANUAL_ADJUSTMENT', 'MISSING_CLOCK_OUT']);
    expect(out[0].message).toBe(STATEMENT_EXCEPTION_TEXT.NEGATIVE_PAYABLE);
  });
});

describe('§67 UNALLOCATED_TIP and MISSING_COMMISSION_RULE (Oct 26 2026)', () => {
  const facts = (over: Partial<ValidationFacts> = {}): ValidationFacts => ({ lines: [{ technicianId: 't1', netCents: 5000, deductionCents: 0, nonTipCents: 5000 }], unassignedSnapshotRows: [],
    paidTicketsWithoutSnapshot: [], tipMismatches: [], duplicateSnapshotKeys: 0, pendingAdjustments: [], openTimeEntries: [], openExceptions: [], legacyRuleLines: 0, reconciliationDrift: [], deductionOverCap: [], ...over });
  it('validation names who served the under-allocated tickets and who was priced by the fallback rate', () => {
    const v = evaluateValidation(facts({ tipMismatches: [{ ticketId: 'k1', tipCents: 1000, allocatedCents: 600, technicianIds: ['t1', 't2'] }, { ticketId: 'k2', tipCents: 500, allocatedCents: 0, technicianIds: ['t2'] }],
      missingRuleTechnicians: ['t3', 't3'] }), '2026-10-26T00:00:00Z');
    expect(v.issues.find((i) => i.code === 'UNALLOCATED_TIP')).toMatchObject({ severity: 'blocking', count: 2, technicianIds: ['t1', 't2'], ticketIds: ['k1', 'k2'] });
    expect(v.issues.find((i) => i.code === 'MISSING_COMMISSION_RULE')).toMatchObject({ severity: 'warning', count: 1, technicianIds: ['t3'] });
    expect(evaluateValidation(facts(), '2026-10-26T00:00:00Z').issues.map((i) => i.code)).not.toContain('MISSING_COMMISSION_RULE');
  });
  it('the statements of those technicians carry the codes; "exceptions only" keeps them and drops a clean one', () => {
    const issues = [{ code: 'UNALLOCATED_TIP', technicianIds: ['t1', 't2'] }, { code: 'MISSING_COMMISSION_RULE', technicianIds: ['t3'] }];
    expect(statementExceptions(base, issues).map((e) => e.code)).toEqual(['UNALLOCATED_TIP']);
    expect(statementExceptions({ ...base, technicianId: 't3' }, issues).map((e) => e.code)).toEqual(['MISSING_COMMISSION_RULE']);
    expect(STATEMENT_EXCEPTION_TEXT.UNALLOCATED_TIP).toMatch(/tip/); expect(STATEMENT_EXCEPTION_TEXT.MISSING_COMMISSION_RULE).toMatch(/commission rule/);
    const st = (tech: string) => ({ technicianName: tech, statementNumber: 'PS-' + tech, branchBreakdown: [], exceptions: statementExceptions({ ...base, technicianId: tech }, issues) });
    expect(['t1', 't3', 't9'].map(st).filter((s) => matchesWeekFilter(s, null, { exceptionsOnly: true })).map((s) => s.technicianName)).toEqual(['t1', 't3']);
  });
});

describe('matchesWeekFilter (§66)', () => {
  const st = (over: Record<string, unknown> = {}) => ({ technicianName: 'Aa Roster 100', statementNumber: 'PS-2026-000100', branchBreakdown: [{ branchId: 'b-main' }], exceptions: [], ...over });
  it('no filter → everyone', () => { expect(matchesWeekFilter(st(), 'b-main', {})).toBe(true); });
  it('exceptions only', () => {
    expect(matchesWeekFilter(st(), 'b-main', { exceptionsOnly: true })).toBe(false);
    expect(matchesWeekFilter(st({ exceptions: [{ code: 'MANUAL_ADJUSTMENT', message: '' }] }), 'b-main', { exceptionsOnly: true })).toBe(true);
  });
  it('search by name (any case) or statement number', () => {
    expect(matchesWeekFilter(st(), null, { search: 'roster 100' })).toBe(true);
    expect(matchesWeekFilter(st(), null, { search: '000100' })).toBe(true);
    expect(matchesWeekFilter(st(), null, { search: 'roster 101' })).toBe(false);
  });
  it('branch: the home branch or a branch the technician earned at this week', () => {
    expect(matchesWeekFilter(st({ branchBreakdown: [] }), 'b-annex', { branchId: 'b-annex' })).toBe(true);
    expect(matchesWeekFilter(st({ branchBreakdown: [{ branchId: 'b-annex' }] }), 'b-main', { branchId: 'b-annex' })).toBe(true);
    expect(matchesWeekFilter(st(), 'b-main', { branchId: 'b-annex' })).toBe(false);
  });
});

describe('weekFilterFromQuery', () => {
  it('legacy and canonical forms; trimmed and bounded', () => {
    expect(weekFilterFromQuery({ exceptionsOnly: '1', search: '  Mary ', branchId: 'b1' })).toEqual({ exceptionsOnly: true, search: 'Mary', branchId: 'b1' });
    expect(weekFilterFromQuery({ filter: { exceptionsOnly: 'true', branchId: 'b2' }, q: 'Lisa' })).toEqual({ exceptionsOnly: true, search: 'Lisa', branchId: 'b2' });
    expect(weekFilterFromQuery({})).toEqual({ exceptionsOnly: false, search: null, branchId: null });
    expect(weekFilterFromQuery(undefined)).toEqual({ exceptionsOnly: false, search: null, branchId: null });
    expect(weekFilterFromQuery({ search: 'x'.repeat(200) }).search).toHaveLength(80);
  });
});
