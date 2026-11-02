// BUILD_PLAN Phase 6 (ai_queue_assignment) — the owner's AI-queue comparison CSV: one row per branch + totals,
// acceptance as a whole percent, blanks (not zeros) for missing values, and no spreadsheet formula injection.
import { describe, it, expect } from 'vitest';
import { buildAiQueueSummaryCsv } from './aiQueueSummaryCsv';

const row = (over: any = {}) => ({ branchId: 'b1', name: 'Cherry Hill', served: 20, avgWaitMinutes: 12, longestWaitMinutes: 40, acceptanceRate: 0.5, staffDecisions: 6, autoAssigned: 3, openAlerts: 1, ...over });

describe('buildAiQueueSummaryCsv', () => {
  it('writes a header, a row per branch and the totals', () => {
    const csv = buildAiQueueSummaryCsv({ branches: [row()], totals: { ...row(), branchId: null, name: null } } as any, 30);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('AI queue assignment — branch comparison,last 30 day(s)');
    expect(lines[1]).toBe('Branch,Served,Average wait (min),Longest wait (min),Acceptance (%),Staff decisions,Auto-assigned,Open alerts');
    expect(lines[2]).toBe('Cherry Hill,20,12,40,50,6,3,1');
    expect(lines[3]).toBe('All branches,20,12,40,50,6,3,1');
  });
  it('leaves a missing wait / rate blank instead of writing 0', () => {
    expect(buildAiQueueSummaryCsv({ branches: [row({ avgWaitMinutes: null, acceptanceRate: null })] }, 7).split('\n')[2]).toBe('Cherry Hill,20,,40,,6,3,1');
  });
  it('neutralises a branch name that a spreadsheet would run as a formula, and quotes commas', () => {
    const csv = buildAiQueueSummaryCsv({ branches: [row({ name: '=HYPERLINK("http://x","y")' }), row({ name: '@SUM(A1)' }), row({ name: 'Main, Street' }), row({ name: '-1+1' })] }, 7);
    const lines = csv.split('\n');
    expect(lines[2]).toMatch(/^"'=HYPERLINK\(""http:\/\/x"",""y""\)",/);
    expect(lines[3].startsWith("'@SUM(A1),")).toBe(true);
    expect(lines[4].startsWith('"Main, Street",')).toBe(true);
    expect(lines[5].startsWith("'-1+1,")).toBe(true);
  });
});
