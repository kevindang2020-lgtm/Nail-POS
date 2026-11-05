// workforce-status.repository.ts — the store port for technician_workforce_state (462) + the in-memory adapter
// (dev/offline/tests). The Kysely adapter lives alongside. Every write is a compare-and-set on `version`.
import type { WorkforceFacts, EmploymentStatus } from './workforce-status-core';

export interface WorkforceRow extends WorkforceFacts {
  tenantId: string;
  branchId: string | null;
  technicianId: string;
  openShiftId: string | null;
  breakStartedAt: string | null;
  updatedAt: string;
  version: number;
}

/** Fair Turn Engine (wave 2): runs INSIDE the CAS transaction after the row moved (the turn queue's clock / break effect
 *  commits with the clock). A store without transactions (in-memory) simply ignores it. */
export type WorkforceCasHook = (trx: any, saved: WorkforceRow) => Promise<void>;

/** Everything the store needs to create a row for a technician that has none yet (backfill on first touch). */
export interface SeedFacts { branchId: string | null; employment: EmploymentStatus; legacyStatus: string | null; openShiftId: string | null; }

export interface WorkforceStateStore {
  get(tenantId: string, technicianId: string): Promise<WorkforceRow | null>;
  /** Tenant-scoped facts used to create the row on first touch; null when the technician does not exist in this tenant. */
  seedFacts(tenantId: string, technicianId: string): Promise<SeedFacts | null>;
  /** INSERT … ON CONFLICT DO NOTHING; returns the row (existing or new). */
  create(row: Omit<WorkforceRow, 'updatedAt' | 'version'>): Promise<WorkforceRow>;
  /**
   * Compare-and-set: UPDATE … WHERE technician_id = ? AND version = expectedVersion. Returns the new row, or null when
   * the version did not match (someone else moved first). Also writes the legacy technician_statuses compat row.
   */
  cas(tenantId: string, technicianId: string, expectedVersion: number, next: WorkforceFacts, extra: { openShiftId?: string | null; breakStartedAt?: string | null; branchId?: string | null }, legacyStatus: string, hook?: WorkforceCasHook): Promise<WorkforceRow | null>;
  listBranch(tenantId: string, branchId: string | null): Promise<WorkforceRow[]>;
  /** True when every cas() records technician.status_changed and the realtime projection delivers it (§343). */
  emitsDomainEvents?(): boolean;
  /** Fair Turn: run the turn-queue hook for a row whose clock state was already right (first touch seeded it from an
   *  open punch, or an idempotent re-sync) — in its own transaction. Absent in memory: there is no turn queue there. */
  turnSync?(row: WorkforceRow, hook: WorkforceCasHook): Promise<void>;
}

export class InMemoryWorkforceStateStore implements WorkforceStateStore {
  readonly rows = new Map<string, WorkforceRow>();
  readonly legacy = new Map<string, string>();
  private seeds = new Map<string, SeedFacts>();
  private key(t: string, id: string) { return `${t}::${id}`; }
  /** test helper — register a technician so first-touch backfill works */
  seedTechnician(tenantId: string, technicianId: string, facts: Partial<SeedFacts> = {}) {
    this.seeds.set(this.key(tenantId, technicianId), { branchId: facts.branchId ?? null, employment: facts.employment ?? 'active', legacyStatus: facts.legacyStatus ?? null, openShiftId: facts.openShiftId ?? null });
  }
  async get(tenantId: string, technicianId: string) { const r = this.rows.get(this.key(tenantId, technicianId)); return r ? { ...r } : null; }
  async seedFacts(tenantId: string, technicianId: string) { const s = this.seeds.get(this.key(tenantId, technicianId)); return s ? { ...s } : null; }
  async create(row: Omit<WorkforceRow, 'updatedAt' | 'version'>) {
    const k = this.key(row.tenantId, row.technicianId);
    const existing = this.rows.get(k); if (existing) return { ...existing };
    const full: WorkforceRow = { ...row, updatedAt: new Date().toISOString(), version: 1 };
    this.rows.set(k, full); return { ...full };
  }
  async cas(tenantId: string, technicianId: string, expectedVersion: number, next: WorkforceFacts, extra: { openShiftId?: string | null; breakStartedAt?: string | null; branchId?: string | null }, legacyStatus: string) {
    const k = this.key(tenantId, technicianId);
    const cur = this.rows.get(k);
    if (!cur || cur.version !== expectedVersion) return null;
    const row: WorkforceRow = { ...cur, ...next, openShiftId: extra.openShiftId !== undefined ? extra.openShiftId : cur.openShiftId, breakStartedAt: extra.breakStartedAt !== undefined ? extra.breakStartedAt : cur.breakStartedAt, branchId: extra.branchId !== undefined ? extra.branchId : cur.branchId, version: cur.version + 1, updatedAt: new Date().toISOString() };
    this.rows.set(k, row); this.legacy.set(k, legacyStatus);
    return { ...row };
  }
  async listBranch(tenantId: string, branchId: string | null) {
    return [...this.rows.values()].filter((r) => r.tenantId === tenantId && (!branchId || r.branchId === branchId || r.branchId === null)).map((r) => ({ ...r }));
  }
}
