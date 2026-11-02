// technician-clock-pin.repository.ts — the repository port re-export plus an in-memory implementation used when no
// Postgres is present (tests, local) and as the module's fallback. The Kysely implementation lives alongside.
import type { ClockPinContext, ClockPinRow, ClockPinRepository, PinnedTechnician, PinLookup } from './technician-clock-pin.service';
import type { PinRateState } from './clock-pin-core';

export type { ClockPinRepository } from './technician-clock-pin.service';

interface Stored { pinHash: string; failedAttempts: number; lockedUntil: string | null; active: boolean; lookup?: string | null; kid?: string | null; }

export class InMemoryClockPinRepository implements ClockPinRepository {
  // keyed by tenant::technician
  private readonly rows = new Map<string, Stored>();
  private key(ctx: ClockPinContext, technicianId: string) { return `${ctx.tenantId}::${technicianId}`; }

  /** test/seed helper — mark whether a technician is active (identify only scans active ones) */
  seedActive(ctx: ClockPinContext, technicianId: string, active: boolean) {
    const r = this.rows.get(this.key(ctx, technicianId)); if (r) r.active = active;
  }

  async getPin(ctx: ClockPinContext, technicianId: string): Promise<ClockPinRow | null> {
    const r = this.rows.get(this.key(ctx, technicianId));
    return r ? { pinHash: r.pinHash, failedAttempts: r.failedAttempts, lockedUntil: r.lockedUntil } : null;
  }
  async upsertPin(ctx: ClockPinContext, technicianId: string, pinHash: string, _actorId?: string | null, lookup?: PinLookup | null): Promise<void> {
    const prev = this.rows.get(this.key(ctx, technicianId));
    this.rows.set(this.key(ctx, technicianId), { pinHash, failedAttempts: 0, lockedUntil: null, active: prev ? prev.active : true, lookup: lookup?.value ?? null, kid: lookup?.kid ?? null });
  }
  /** test counter: how many candidates the last identify scan was handed */
  lastCandidateCount = 0;
  async setLookup(ctx: ClockPinContext, technicianId: string, lookup: PinLookup): Promise<void> {
    const r = this.rows.get(this.key(ctx, technicianId)); if (r) { r.lookup = lookup.value; r.kid = lookup.kid; }
  }
  async setPinHash(ctx: ClockPinContext, technicianId: string, pinHash: string): Promise<void> {
    const r = this.rows.get(this.key(ctx, technicianId)); if (r) r.pinHash = pinHash;
  }
  async updateRateState(ctx: ClockPinContext, technicianId: string, state: PinRateState): Promise<void> {
    const r = this.rows.get(this.key(ctx, technicianId));
    if (r) { r.failedAttempts = state.failedAttempts; r.lockedUntil = state.lockedUntil; }
  }
  async listActivePinnedTechnicians(ctx: ClockPinContext, lookup?: PinLookup | null): Promise<PinnedTechnician[]> {
    const out: PinnedTechnician[] = [];
    for (const [k, r] of this.rows) {
      if (!k.startsWith(`${ctx.tenantId}::`) || !r.active) continue;
      if (lookup && r.kid === lookup.kid && r.lookup !== lookup.value) continue;
      out.push({ technicianId: k.slice(ctx.tenantId.length + 2), pinHash: r.pinHash, failedAttempts: r.failedAttempts, lockedUntil: r.lockedUntil, lookupKid: r.kid ?? null });
    }
    this.lastCandidateCount = out.length;
    return out;
  }
}
