// fair-turn-200.vitest.spec.ts — 200-technician mandate §30–§32: Fair Turn over 200 technicians spread across every state
// (ready, serving, break, hold, clocked out / not in rotation, skill-ineligible, appointment soon, at capacity) is
// eligibility-first, deterministic (input order never changes the pick), fast, and explains itself without private data.
import { describe, it, expect } from 'vitest';
import { RECOMMENDED_TURN_POLICY, type TurnStateLike } from '@aipowersalon/workforce';
import { rankFairTurn, type FairTurnCandidate } from './fair-turn-engine';

const NOW = Date.parse('2026-10-23T16:00:00Z');
const ago = (m: number) => new Date(NOW - m * 60000).toISOString();
const st = (id: string, o: Partial<TurnStateLike> = {}): TurnStateLike => ({
  technicianId: id, status: 'READY', inRotation: true, rotationPosition: 1, accumulatedUnits: 0, provisionalUnits: 0, pendingUnits: 0, baselineUnits: 0, specialUnits: 0,
  serviceMinutes: 0, baselineMinutes: 0, readySince: ago(10), eligibleSkipCount: 0, consecutiveAuto: 0, ...o,
});
const base = { mode: 'traditional_weighted_rotation' as const, policy: { ...RECOMMENDED_TURN_POLICY }, assignmentMode: 'RECOMMEND_AND_CONFIRM' as const, policyVersion: '1', nowMs: NOW };

/** #1..#200: the state mix of a busy opening (§76) — the front of the rotation is deliberately full of people who can't take the guest */
function salon(): FairTurnCandidate[] {
  return Array.from({ length: 200 }, (_, i) => {
    const n = i + 1, id = 'tech-' + String(n).padStart(3, '0'), name = 'Tech ' + n;
    const turn = st(id, { rotationPosition: n, accumulatedUnits: (n * 7) % 5, readySince: ago(200 - n) });
    if (n % 10 === 1) return { technicianId: id, name, turn: st(id, { ...turn, status: 'SERVING' }), hardFails: ['at_capacity'] };
    if (n % 10 === 2) return { technicianId: id, name, turn: st(id, { ...turn, status: 'BREAK' }), hardFails: [] };
    if (n % 10 === 3) return { technicianId: id, name, turn: st(id, { ...turn, status: 'HOLD', holdReason: 'manager' }), hardFails: [] };
    if (n % 10 === 4) return { technicianId: id, name, turn: n > 150 ? null : st(id, { ...turn, status: 'CLOCKED_OUT', inRotation: false }), hardFails: ['not_clocked_in'] };
    if (n % 10 === 5) return { technicianId: id, name, turn, hardFails: ['missing_skill'] };
    if (n % 10 === 6) return { technicianId: id, name, turn, hardFails: ['appointment_reserved'], nextAppointmentInMinutes: 20 };
    return { technicianId: id, name, turn, hardFails: [] };            // ready + exact-skilled + appointment-safe
  });
}
const shuffle = <T,>(a: T[], seed: number) => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

describe('Fair Turn with 200 technicians', () => {
  const all = salon();
  const r = rankFairTurn({ ...base, serviceLabel: 'gel manicure', candidates: all });
  const eligibleIds = all.filter((c) => c.hardFails.length === 0 && c.turn?.status === 'READY').map((c) => c.technicianId);

  it('hard eligibility comes before fairness: the pick and every eligible one are ready, skilled and appointment-safe', () => {
    expect(r.recommendedTechnicianId).not.toBeNull();
    expect(eligibleIds).toContain(r.recommendedTechnicianId);
    expect([...r.eligibleOrder].sort()).toEqual([...eligibleIds].sort());
    for (const x of r.ranking) if (!eligibleIds.includes(x.technicianId)) expect(x.eligible).toBe(false);
  });

  it('everyone ranked ahead of the pick is skipped WITH a reason and keeps the place (§16, §32)', () => {
    const pickRank = r.ranking.find((x) => x.technicianId === r.recommendedTechnicianId)!.turnRank!;
    const ahead = r.ranking.filter((x) => x.turnRank != null && x.turnRank < pickRank);
    expect(ahead.length).toBeGreaterThan(0);
    expect(new Set(r.skips.map((s) => s.technicianId))).toEqual(new Set(ahead.map((x) => x.technicianId)));
    for (const s of r.skips) expect(s.reason).toMatch(/^[A-Z_]+$/);
    const reasons = new Set(r.skips.map((s) => s.reason));
    for (const want of ['ALREADY_SERVING', 'ON_BREAK', 'MANAGER_HOLD', 'SKILL_INELIGIBLE', 'APPOINTMENT_CONFLICT']) expect(reasons.has(want as any), want).toBe(true);
  });

  it('is deterministic: five different input orders give the same pick, order and skips', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      const s = rankFairTurn({ ...base, serviceLabel: 'gel manicure', candidates: shuffle(all, seed) });
      expect(s.recommendedTechnicianId).toBe(r.recommendedTechnicianId);
      expect(s.eligibleOrder).toEqual(r.eligibleOrder);
      expect(s.skips).toEqual(r.skips);
    }
  });

  it('explains the pick and carries no pay data', () => {
    expect(r.why.length).toBeGreaterThan(0);
    expect(r.why[0]).toMatch(/selected because/);
    expect(JSON.stringify(r)).not.toMatch(/payroll|commission|wage|salary|cents|payable|tax/i);
  });

  it('is fast: 200 candidates ranked in well under 50 ms on average', () => {
    const N = 50; const t0 = performance.now();
    for (let i = 0; i < N; i++) rankFairTurn({ ...base, candidates: all });
    const avg = (performance.now() - t0) / N;
    console.log(`[fair-turn-200] average rank time over ${N} runs: ${avg.toFixed(2)} ms`);
    expect(avg).toBeLessThan(50);
  });

  it('when NOBODY can take the guest, it answers no pick — never a forced ineligible technician', () => {
    const none = all.map((c) => ({ ...c, hardFails: c.hardFails.length ? c.hardFails : ['missing_skill'] }));
    const z = rankFairTurn({ ...base, candidates: none });
    expect(z.recommendedTechnicianId).toBeNull();
    expect(z.eligibleOrder).toEqual([]);
  });
});
