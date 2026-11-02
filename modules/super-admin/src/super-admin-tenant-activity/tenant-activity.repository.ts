// tenant-activity.repository.ts — data port for the Tenant Activity read-model. Adapters only fetch raw audit rows;
// all formatting/filtering/paging lives in tenant-activity-core (pure + tested).
import type { ActivityRaw } from './tenant-activity-core';

export interface TenantActivityRepo {
  /** Most-recent audit_logs rows (joined to tenants), newest first. Bounded for in-memory filtering. */
  all(): Promise<ActivityRaw[]>;
}

/** In-memory adapter: no DB → empty feed (never fabricated). */
export class InMemoryTenantActivityRepo implements TenantActivityRepo {
  constructor(private readonly seed: ActivityRaw[] = []) {}
  async all(): Promise<ActivityRaw[]> { return this.seed; }
}
