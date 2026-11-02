// deployments.repository.ts — port + in-memory adapter (dev/offline/test default), seeded for tenant 'luxe001'
// only. installed_version may be null (provider hasn't reported); status drives the lifecycle.
import type { DeploymentsContext } from './deployments.dto';
import type { DeployStatus } from './deployments-core';

export interface StoredDeployment {
  id: string; component: string; componentKind: string; installedVersion: string | null; latestVersion: string | null;
  targetCount: number; status: DeployStatus; scheduledMs: number | null; branchId: string | null; createdMs: number;
}
export interface NewDeployment { component: string; componentKind: string; installedVersion: string | null; latestVersion: string | null; targetCount: number; status: DeployStatus; branchId: string | null; createdByUserId: string | null }

export interface DeploymentsRepositoryPort {
  list(ctx: DeploymentsContext): Promise<StoredDeployment[]>;
  insert(ctx: DeploymentsContext, d: NewDeployment): Promise<StoredDeployment>;
  get(ctx: DeploymentsContext, id: string): Promise<StoredDeployment | null>;
  updateStatus(ctx: DeploymentsContext, id: string, status: DeployStatus, scheduledMs: number | null): Promise<StoredDeployment | null>;
}

const SEED = 'luxe001';
let seq = 1;

// [component, kind, installed, latest, targets, status]
const SEED_ROWS: Array<[string, string, string | null, string | null, number, DeployStatus]> = [
  ['iPad App (Front Desk)', 'app', 'v3.2.1', 'v3.3.0', 2, 'available'],
  ['Tech App (Phone)', 'app', 'v2.7.4', 'v2.8.0', 5, 'available'],
  ['Kiosk App (Check-In)', 'app', 'v1.9.0', 'v2.0.0', 1, 'available'],
  ['AI Receptionist (Twilio)', 'app', 'v1.4.2', 'v1.4.2', 0, 'up_to_date'],
  ['Payment Firmware', 'firmware', null, 'fw-2025.4', 2, 'available'],
];

export class InMemoryDeploymentsRepository implements DeploymentsRepositoryPort {
  private byTenant = new Map<string, StoredDeployment[]>();
  private arr(ctx: DeploymentsContext): StoredDeployment[] {
    if (!this.byTenant.has(ctx.tenantId)) {
      const now = Date.now();
      this.byTenant.set(ctx.tenantId, ctx.tenantId === SEED
        ? SEED_ROWS.map(([component, kind, installed, latest, targets, status], i) => ({ id: `dep_seed_${i + 1}`, component, componentKind: kind, installedVersion: installed, latestVersion: latest, targetCount: targets, status, scheduledMs: null, branchId: null, createdMs: now - 7 * 86_400_000 }))
        : []);
    }
    return this.byTenant.get(ctx.tenantId)!;
  }
  async list(ctx: DeploymentsContext) { return this.arr(ctx).map((d) => ({ ...d })); }
  async insert(ctx: DeploymentsContext, d: NewDeployment) {
    const row: StoredDeployment = { id: `dep_${seq++}`, component: d.component, componentKind: d.componentKind, installedVersion: d.installedVersion, latestVersion: d.latestVersion, targetCount: d.targetCount, status: d.status, scheduledMs: null, branchId: d.branchId, createdMs: Date.now() };
    this.arr(ctx).push(row); return { ...row };
  }
  async get(ctx: DeploymentsContext, id: string) { const d = this.arr(ctx).find((x) => x.id === id); return d ? { ...d } : null; }
  async updateStatus(ctx: DeploymentsContext, id: string, status: DeployStatus, scheduledMs: number | null) {
    const d = this.arr(ctx).find((x) => x.id === id); if (!d) return null;
    d.status = status; if (scheduledMs != null) d.scheduledMs = scheduledMs; return { ...d };
  }
}
