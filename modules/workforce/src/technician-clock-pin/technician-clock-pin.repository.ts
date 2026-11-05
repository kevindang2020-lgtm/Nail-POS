// technician-clock-pin.repository.ts — the repository port re-export plus an in-memory implementation used when no
// Postgres is present (tests, local) and as the module's fallback. The Kysely implementation lives alongside.
import type { ClockPinContext, ClockPinRow, ClockPinRepository, PinnedTechnician } from './technician-clock-pin.service';
import type { PinRateState } from './clock-pin-core';

export type { ClockPinRepository } from './technician-clock-pin.service';

interface Stored { pinHash: string; failedAttempts: number; lockedUntil: string | null; active: boolean; }

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
  async upsertPin(ctx: ClockPinContext, technicianId: string, pinHash: string): Promise<void> {
    const prev = this.rows.get(this.key(ctx, technicianId));
    this.rows.set(this.key(ctx, technicianId), { pinHash, failedAttempts: 0, lockedUntil: null, active: prev ? prev.active : true });
  }
  async updateRateState(ctx: ClockPinContext, technicianId: string, state: PinRateState): Promise<void> {
    const r = this.rows.get(this.key(ctx, technicianId));
    if (r) { r.failedAttempts = state.failedAttempts; r.lockedUntil = state.lockedUntil; }
  }
  async listActivePinnedTechnicians(ctx: ClockPinContext): Promise<PinnedTechnician[]> {
    const out: PinnedTechnician[] = [];
    for (const [k, r] of this.rows) {
      if (!k.startsWith(`${ctx.tenantId}::`) || !r.active) continue;
      out.push({ technicianId: k.slice(ctx.tenantId.length + 2), pinHash: r.pinHash, failedAttempts: r.failedAttempts, lockedUntil: r.lockedUntil });
    }
    return out;
  }
}
