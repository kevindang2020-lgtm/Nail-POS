// ai-governance.repository.ts — repo contract for control modes. set() upserts on (tenantId, assistantKey). Scope
// from session, never client.
import type { ControlMode } from './ai-governance.dto';

export interface ModeRow { assistantKey: string; mode: ControlMode; updatedByUserId: string | null; updatedAt: string | null }
export interface AiGovernanceRepo {
  list(tenantId: string): Promise<ModeRow[]>;
  set(tenantId: string, assistantKey: string, mode: ControlMode, userId: string | null): Promise<void>;
}

export class InMemoryAiGovernanceRepo implements AiGovernanceRepo {
  public rows = new Map<string, ModeRow>();
  async list(_tenantId: string): Promise<ModeRow[]> { return [...this.rows.values()]; }
  async set(_tenantId: string, assistantKey: string, mode: ControlMode, userId: string | null): Promise<void> {
    this.rows.set(assistantKey, { assistantKey, mode, updatedByUserId: userId, updatedAt: new Date().toISOString() });
  }
}
