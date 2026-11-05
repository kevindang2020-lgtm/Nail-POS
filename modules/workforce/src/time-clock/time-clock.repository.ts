// time-clock.repository.ts — port + in-memory adapter (dev/offline/tests default).
import type { TimeClockContext, ShiftPunch, BreakRow } from './time-clock.dto';
import { ACTIVE_STATUS, CLOCKED_OUT_STATUS, isActivePunch } from './time-clock.dto';

export interface TechnicianRef { technicianId: string; technicianName: string | null; avatarUrl?: string | null; }

export interface TimeClockRepositoryPort {
  /** true when the clock change reaches clients through the domain-event projection (outbox AND publisher on) */
  emitsDomainEvents?(): boolean;
  // Active technicians (for the roster) + today's punches, tenant/branch scoped.
  listTechnicians(ctx: TimeClockContext): Promise<TechnicianRef[]>;
  listTodayPunches(ctx: TimeClockContext, dateStr: string): Promise<ShiftPunch[]>;
  technicianExists(ctx: TimeClockContext, technicianId: string): Promise<boolean>;
  /** The technician's OPEN punch (no end), whatever its date. */
  findOpenPunch(ctx: TimeClockContext, technicianId: string): Promise<ShiftPunch | null>;
  /** Insert an open punch. `created=false` + the existing open punch when the partial unique index (580) already
   *  holds one — a double clock-in is ONE transition (mandate §106 / §165). */
  insertPunch(ctx: TimeClockContext, technicianId: string, dateStr: string, startIso: string): Promise<{ punch: ShiftPunch; created: boolean }>;
  /** The branch's zone (branches.timezone → America/New_York); shift_date is that zone's day from Oct 3 2026. */
  timeZone?(ctx: TimeClockContext): Promise<string>;
  /** Close the punch ONLY if it is still open (compare-and-set on end_time IS NULL). null when it was not open. */
  closePunch(ctx: TimeClockContext, punchId: string, endIso: string): Promise<ShiftPunch | null>;
  /** Open a break row (one OPEN break per technician — partial unique). `created=false` + existing when already on one. */
  openBreak(ctx: TimeClockContext, technicianId: string, shiftId: string | null, startIso: string, by: string, kind: string, reason?: string | null): Promise<{ brk: BreakRow; created: boolean }>;
  /** Close the technician's open break; null when there was none. */
  closeBreak(ctx: TimeClockContext, technicianId: string, endIso: string, by: string): Promise<BreakRow | null>;
  /** Breaks that started on the salon-local day `dateStr` (zone `tz`) plus every still-open break. */
  listBreaksForDate(ctx: TimeClockContext, dateStr: string, tz: string): Promise<BreakRow[]>;
  // ── Fair Turn Engine §31–40 (migration 603): the break policy, the classification, the interruption ───────────────
  /** the salon / branch break-policy layers (raw JSON) + the version of the layer that applies */
  breakPolicyLayers?(ctx: TimeClockContext): Promise<{ salon: unknown; branch: unknown; version: number }>;
  saveBreakPolicy?(ctx: TimeClockContext, scope: 'salon' | 'branch', policy: Record<string, unknown>, reason: string | null): Promise<{ version: number }>;
  /** stamp the compensable treatment on a closed break */
  classifyBreak?(ctx: TimeClockContext, breakId: string, c: { classification: string; paidMinutes: number; unpaidMinutes: number; policyVersion: number }): Promise<void>;
  /** close the open break as INTERRUPTED (called back to work, §36); null when none is open */
  interruptBreak?(ctx: TimeClockContext, technicianId: string, endIso: string, by: string, reason: string): Promise<BreakRow | null>;
}

export class InMemoryTimeClockRepository implements TimeClockRepositoryPort {
  private techs: TechnicianRef[];
  private punches: ShiftPunch[];
  private breaks: BreakRow[] = [];
  // shift_date per punch, like the real table. A seeded punch with no shiftDate matches every date (older tests).
  private dates = new Map<string, string>();
  constructor(techs: TechnicianRef[] = [], punches: (ShiftPunch & { shiftDate?: string })[] = []) {
    this.techs = techs.slice();
    this.punches = punches.map(({ shiftDate, ...p }) => { if (shiftDate) this.dates.set(p.id, shiftDate); return p; });
  }
  async listTechnicians(): Promise<TechnicianRef[]> { return this.techs.slice(); }
  async listTodayPunches(_ctx?: TimeClockContext, dateStr?: string): Promise<ShiftPunch[]> {
    return this.punches.filter((p) => !dateStr || !this.dates.has(p.id) || this.dates.get(p.id) === dateStr);
  }
  async technicianExists(_ctx: TimeClockContext, id: string): Promise<boolean> { return this.techs.some((t) => t.technicianId === id); }
  async findOpenPunch(_ctx: TimeClockContext, technicianId: string): Promise<ShiftPunch | null> { return this.punches.filter((p) => p.technicianId === technicianId).find(isActivePunch) ?? null; }
  async insertPunch(_ctx: TimeClockContext, technicianId: string, _dateStr: string, startIso: string): Promise<{ punch: ShiftPunch; created: boolean }> {
    const open = await this.findOpenPunch(_ctx, technicianId);
    if (open) return { punch: open, created: false };   // mirrors the partial unique index
    const p: ShiftPunch = { id: 'punch_' + (this.punches.length + 1), technicianId, shiftDate: _dateStr, startTime: startIso, endTime: null, status: ACTIVE_STATUS };
    this.punches.push(p); this.dates.set(p.id, _dateStr); return { punch: p, created: true };
  }
  async closePunch(_ctx: TimeClockContext, punchId: string, endIso: string): Promise<ShiftPunch | null> {
    const p = this.punches.find((x) => x.id === punchId); if (!p || p.endTime) return null;
    p.endTime = endIso; p.status = CLOCKED_OUT_STATUS; return p;
  }
  async openBreak(_ctx: TimeClockContext, technicianId: string, shiftId: string | null, startIso: string, by: string, kind: string, reason?: string | null) {
    const open = this.breaks.find((b) => b.technicianId === technicianId && !b.endedAt);
    if (open) return { brk: open, created: false };
    const brk: BreakRow = { id: 'break_' + (this.breaks.length + 1), technicianId, shiftId, kind, reason: reason ?? null, startedAt: startIso, endedAt: null, startedBy: by, endedBy: null };
    this.breaks.push(brk); return { brk, created: true };
  }
  async closeBreak(_ctx: TimeClockContext, technicianId: string, endIso: string, by: string) {
    const open = this.breaks.find((b) => b.technicianId === technicianId && !b.endedAt); if (!open) return null;
    open.endedAt = endIso; open.endedBy = by; return open;
  }
  readonly classified = new Map<string, { classification: string; paidMinutes: number; unpaidMinutes: number; policyVersion: number }>();
  private policy: { salon: unknown; branch: unknown; version: number } = { salon: null, branch: null, version: 0 };
  async breakPolicyLayers() { return this.policy; }
  async saveBreakPolicy(_ctx: TimeClockContext, scope: 'salon' | 'branch', policy: Record<string, unknown>) { this.policy = { ...this.policy, [scope]: policy, version: this.policy.version + 1 }; return { version: this.policy.version }; }
  async classifyBreak(_ctx: TimeClockContext, breakId: string, c: { classification: string; paidMinutes: number; unpaidMinutes: number; policyVersion: number }) { this.classified.set(breakId, c); }
  async interruptBreak(_ctx: TimeClockContext, technicianId: string, endIso: string, by: string, reason: string) {
    const open = this.breaks.find((b) => b.technicianId === technicianId && !b.endedAt); if (!open) return null;
    open.endedAt = endIso; open.endedBy = by; (open as any).interruptedAt = endIso; (open as any).interruptionReason = reason; return open;
  }
  async listBreaksForDate(): Promise<BreakRow[]> { return this.breaks.slice(); }
  // test helpers
  activeFor(technicianId: string): ShiftPunch | undefined { return this.punches.filter((p) => p.technicianId === technicianId).find(isActivePunch); }
  allPunches(): ShiftPunch[] { return this.punches.slice(); }
  allBreaks(): BreakRow[] { return this.breaks.slice(); }
}
