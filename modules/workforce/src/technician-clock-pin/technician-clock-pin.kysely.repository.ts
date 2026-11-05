// technician-clock-pin.kysely.repository.ts — Postgres adapter over technician_clock_pins, tenant-scoped from ctx.
// identify only considers rows whose technician is active AND at the device's branch, joined to the technicians table
// (mirroring the tenant/branch scoping the time-clock repo uses). The plaintext PIN never appears here — only its hash.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ClockPinContext, ClockPinRow, ClockPinRepository, PinnedTechnician } from './technician-clock-pin.service';
import type { PinRateState } from './clock-pin-core';

export class KyselyClockPinRepository implements ClockPinRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async getPin(ctx: ClockPinContext, technicianId: string): Promise<ClockPinRow | null> {
    const r: any = await this.db.selectFrom('technician_clock_pins')
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .where('disabled_at', 'is', null)   // 453: a disabled PIN (suspended/terminated technician) reads as "no PIN"
      .select(['pin_hash', 'failed_attempts', 'locked_until']).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return { pinHash: String(r.pin_hash), failedAttempts: Number(r.failed_attempts || 0), lockedUntil: r.locked_until ? new Date(r.locked_until).toISOString() : null };
  }

  async upsertPin(ctx: ClockPinContext, technicianId: string, pinHash: string, actorId: string | null): Promise<void> {
    await this.db.insertInto('technician_clock_pins')
      .values({ tenant_id: ctx.tenantId, technician_id: technicianId, pin_hash: pinHash, failed_attempts: 0, locked_until: null, disabled_at: null, disabled_reason: null, updated_by: actorId, updated_at: new Date() })
      .onConflict((oc) => oc.columns(['tenant_id', 'technician_id']).doUpdateSet({ pin_hash: pinHash, failed_attempts: 0, locked_until: null, disabled_at: null, disabled_reason: null, updated_by: actorId, updated_at: new Date() }))
      .execute();
  }

  async updateRateState(ctx: ClockPinContext, technicianId: string, state: PinRateState): Promise<void> {
    await this.db.updateTable('technician_clock_pins')
      .set({ failed_attempts: state.failedAttempts, locked_until: state.lockedUntil ? new Date(state.lockedUntil) : null, updated_at: new Date() })
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).execute();
  }

  async listActivePinnedTechnicians(ctx: ClockPinContext): Promise<PinnedTechnician[]> {
    let q = this.db.selectFrom('technician_clock_pins as p')
      .innerJoin('technicians as t', (j) => j.onRef('t.id', '=', 'p.technician_id').on('t.tenant_id', '=', ctx.tenantId))
      .where('p.tenant_id', '=', ctx.tenantId).where('t.is_active', '=', true).where('p.disabled_at', 'is', null);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('t.branch_id', '=', ctx.branchId), eb('t.branch_id', 'is', null)]));
    const rows: any[] = await q.select(['p.technician_id as technician_id', 'p.pin_hash as pin_hash', 'p.failed_attempts as failed_attempts', 'p.locked_until as locked_until']).execute().catch(() => []);
    return rows.map((r) => ({ technicianId: String(r.technician_id), pinHash: String(r.pin_hash), failedAttempts: Number(r.failed_attempts || 0), lockedUntil: r.locked_until ? new Date(r.locked_until).toISOString() : null }));
  }
}
