// pilot-large-salon-blocks.vitest.spec — the 200-technician pilot's blocked-time dataset (§48 / §49 / §76): the plan the
// live pilot writes through POST /pos/booking/blocked-times, and the overlap rule its availability assertion uses.
import { describe, it, expect } from 'vitest';
const { planBlocks, overlapsBlock, BLOCK_LUNCH, BLOCK_BREAK }: any = await import('../../scripts/lib/pilot-large-salon-blocks.mjs');   // a plain .mjs pilot helper

const days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
const ids = Array.from({ length: 200 }, (_, i) => 't' + (i + 1));

describe('pilot blocked-time plan (200 × 7)', () => {
  it('lunch + break every day for everyone; every 10th technician has one full day off instead', () => {
    const plan = planBlocks(ids, days) as Array<{ technicianId: string; date: string; reason: string; startTime: string; endTime: string }>;
    const by = (r: string) => plan.filter((b) => b.reason === r);
    expect(by('time off').length).toBe(20);
    expect(by('lunch').length).toBe(200 * 7 - 20);
    expect(by('break').length).toBe(200 * 7 - 20);
    expect(plan.length).toBe(2 * 1400 - 20);
    // the 20 days off rotate over the week, one per technician, never with a lunch the same day
    const off = by('time off');
    expect(new Set(off.map((b) => b.technicianId)).size).toBe(20);
    expect(new Set(off.map((b) => b.date)).size).toBe(7);
    for (const o of off) expect(plan.some((b) => b.technicianId === o.technicianId && b.date === o.date && b.reason !== 'time off')).toBe(false);
    expect(plan.every((b) => b.startTime < b.endTime)).toBe(true);
  });
  it('overlapsBlock: a start whose service would run into lunch or a break is out; touching edges are fine', () => {
    const blocks = [BLOCK_LUNCH, BLOCK_BREAK];
    expect(overlapsBlock('11:30', 30, blocks)).toBe(false);   // ends 12:00
    expect(overlapsBlock('11:45', 30, blocks)).toBe(true);    // runs into 12:00
    expect(overlapsBlock('12:15', 15, blocks)).toBe(true);
    expect(overlapsBlock('12:30', 45, blocks)).toBe(false);
    expect(overlapsBlock('14:30', 45, blocks)).toBe(true);    // into the 15:00 break
    expect(overlapsBlock('15:15', 30, blocks)).toBe(false);
  });
});
