// ai-scheduling-capacity.ts — Extras "Capacity Risk Heatmap" (AI Scheduling Optimizer 07): an OPTIONAL, read-only per-hour
// summary of one day at the session branch — staffed minutes vs booked demand, and per service category (skill) the demand
// vs the technicians on shift who are qualified for it. It reads the SAME DayData the optimizer's gate reads (real shifts,
// breaks, blocked time, approved time off, every appointment and live hold) and the ONE workforce skill rule (techQualifiedFor).
// It never replaces the booking board, never books, moves, holds or sends anything.
import { intersect, mergeRanges, subtractRanges, totalCovered, type Range } from './ai-scheduling-core';
import { INACTIVE_STATUSES, techQualifiedFor, utilizationPct, hhmm, type DayData } from './ai-scheduling-day';

export type CapacityRisk = 'closed' | 'unstaffed' | 'over' | 'tight' | 'ok';
export interface CapacitySkillHour { category: string; demandMin: number; techsNeeded: number; qualifiedOnShift: number; short: boolean }
export interface CapacityHour {
  hour: string; startMin: number; endMin: number;
  techsOnShift: number; staffedMin: number; bookedMin: number; unassignedMin: number; heldMin: number;
  utilizationPct: number | null; risk: CapacityRisk; skills: CapacitySkillHour[]; skillShort: boolean;
}
export interface CapacityHeatmap {
  date: string; branchId: string; timeZone: string; tightAtPct: number;
  hours: CapacityHour[];
  totals: { staffedMin: number; bookedMin: number; overHours: number; tightHours: number; unstaffedHours: number; skillShortHours: number };
  basis: string;
}

/** at or above this utilization an hour is "tight" (one late visit or walk-in has nowhere to go) */
export const CAPACITY_TIGHT_PCT = 85;
const covered = (ranges: Range[], w: Range) => totalCovered(mergeRanges(ranges.map((r) => intersect(r, w)).filter((x): x is Range => !!x)));
const overlapMin = (r: Range, w: Range) => { const x = intersect(r, w); return x ? x.end - x.start : 0; };

export function capacityHeatmap(day: DayData): CapacityHeatmap {
  const active = day.appts.filter((a) => !INACTIVE_STATUSES.has(a.status) && a.endMin > a.startMin);
  // each available technician's working minutes: shifts minus breaks / blocked time / approved time off
  const working = day.techs.filter((t) => t.available).map((t) => {
    const blocked = mergeRanges([...t.breaks, ...t.timeOff]);
    return { id: t.technicianId, ranges: mergeRanges(t.shifts).flatMap((w) => subtractRanges(w, blocked)) };
  });
  // the hours shown: the branch's hours, widened to any shift / appointment outside them (never hidden)
  const edges = [...(day.branchHours ? [day.branchHours] : []), ...working.flatMap((w) => w.ranges), ...active.map((a) => ({ start: a.startMin, end: a.endMin }))];
  const hours: CapacityHour[] = [];
  if (edges.length) {
    const from = Math.floor(Math.min(...edges.map((r) => r.start)) / 60) * 60, to = Math.ceil(Math.max(...edges.map((r) => r.end)) / 60) * 60;
    for (let s = Math.max(0, from); s < Math.min(1440, to); s += 60) {
      const w: Range = { start: s, end: s + 60 };
      const onShift = working.map((x) => ({ id: x.id, min: covered(x.ranges, w) })).filter((x) => x.min > 0);
      const staffedMin = onShift.reduce((n, x) => n + x.min, 0);
      let bookedMin = 0, unassignedMin = 0;
      const demand = new Map<string, { min: number; serviceIds: Set<string> }>();
      for (const a of active) {
        const m = overlapMin({ start: a.startMin, end: a.endMin }, w); if (!m) continue;
        bookedMin += m; if (!a.technicianId) unassignedMin += m;
        // a visit needing services of several categories counts toward each of them (it needs each skill)
        const byCat = new Map<string, string[]>();
        for (const sid of a.serviceIds) { const c = day.services[sid]?.categoryName || 'Other'; (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(sid); }
        for (const [c, sids] of byCat) { const d = demand.get(c) ?? demand.set(c, { min: 0, serviceIds: new Set() }).get(c)!; d.min += m; sids.forEach((x) => d.serviceIds.add(x)); }
      }
      const heldMin = day.holds.reduce((n, h) => n + overlapMin(h.range, w), 0);
      const skills: CapacitySkillHour[] = [...demand.entries()].sort((a, z) => z[1].min - a[1].min || a[0].localeCompare(z[0])).map(([category, d]) => {
        const qualifiedOnShift = onShift.filter((x) => [...d.serviceIds].some((sid) => techQualifiedFor(day, x.id, sid))).length;
        const techsNeeded = Math.ceil(d.min / 60);
        return { category, demandMin: d.min, techsNeeded, qualifiedOnShift, short: techsNeeded > qualifiedOnShift };
      });
      const load = bookedMin + heldMin;
      const util = utilizationPct(load, staffedMin);
      const risk: CapacityRisk = !staffedMin ? (load ? 'unstaffed' : 'closed') : load > staffedMin ? 'over' : (util ?? 0) >= CAPACITY_TIGHT_PCT ? 'tight' : 'ok';
      hours.push({ hour: hhmm(s), startMin: s, endMin: s + 60, techsOnShift: onShift.length, staffedMin, bookedMin, unassignedMin, heldMin,
        utilizationPct: util, risk, skills, skillShort: skills.some((x) => x.short) });
    }
  }
  return {
    date: day.date, branchId: day.branchId, timeZone: day.timeZone, tightAtPct: CAPACITY_TIGHT_PCT, hours,
    totals: {
      staffedMin: hours.reduce((n, h) => n + h.staffedMin, 0), bookedMin: hours.reduce((n, h) => n + h.bookedMin, 0),
      overHours: hours.filter((h) => h.risk === 'over').length, tightHours: hours.filter((h) => h.risk === 'tight').length,
      unstaffedHours: hours.filter((h) => h.risk === 'unstaffed').length, skillShortHours: hours.filter((h) => h.skillShort).length,
    },
    basis: 'Staffed = shift minutes minus breaks, blocked time and approved time off of available technicians. Booked = minutes of every appointment that is not cancelled or a no-show; held = live booking holds. Qualified = the workforce skill rule the optimizer uses.',
  };
}
