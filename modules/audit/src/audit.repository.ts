// audit.repository.ts — append-only audit store port + in-memory adapter. The port exposes ONLY record + reads; there
// is intentionally no update or delete method, so "append-only" is enforced at the type level (no caller can mutate
// or remove an audit row through this interface).
import { randomUUID } from 'crypto';
import type { AuditContext, AuditEventInput, AuditEventRow, AuditFilters } from './audit.dto';
import { buildAuditRow, applyAuditFilters, redactMetadata } from './audit.dto';
import { clampPage } from '@aipowersalon/api-contracts';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { AuditPage } from '@aipowersalon/api-contracts/tenant';
import type { AuditPage } from '@aipowersalon/api-contracts/tenant';


// A platform-level (tenant-less) event: a Super Admin action such as an emergency disable. audit_events requires a
// tenant, so these go to audit_logs, the table every other platform action already writes.
export interface PlatformAuditInput extends AuditEventInput {
  userId?: string | null;
  role?: string | null;
}

export interface AuditRepositoryPort {
  record(ctx: AuditContext, input: AuditEventInput): Promise<AuditEventRow>;
  recordPlatform(input: PlatformAuditInput): Promise<void>;
  // Tenant-scoped read (the caller's tenant only).
  list(tenantId: string, filters: AuditFilters): Promise<AuditPage>;
  // Cross-tenant read — Super Admin only (the controller enforces the guard).
  listPlatform(filters: AuditFilters & { tenantId?: string }): Promise<AuditPage>;
}

function paginate(rows: AuditEventRow[], f: AuditFilters): AuditPage {
  const sorted = rows.slice().sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const page = clampPage(f.page);
  const pageSize = Math.min(200, Math.max(1, Number(f.pageSize) || 50));
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return { items: sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), pagination: { page, pageSize, totalItems, totalPages } };
}

export class InMemoryAuditRepository implements AuditRepositoryPort {
  private rows: AuditEventRow[] = [];
  readonly platformRows: PlatformAuditInput[] = [];

  async record(ctx: AuditContext, input: AuditEventInput): Promise<AuditEventRow> {
    const base = buildAuditRow(ctx, input);
    const row: AuditEventRow = { id: randomUUID(), occurredAt: new Date().toISOString(), ...base };
    this.rows.push(row);
    return row;
  }

  async recordPlatform(input: PlatformAuditInput): Promise<void> {
    this.platformRows.push({ ...input, metadata: redactMetadata(input.metadata) });
  }

  async list(tenantId: string, filters: AuditFilters): Promise<AuditPage> {
    const scoped = this.rows.filter((r) => r.tenantId === tenantId);
    return paginate(applyAuditFilters(scoped, filters), filters);
  }

  async listPlatform(filters: AuditFilters & { tenantId?: string }): Promise<AuditPage> {
    const all = filters.tenantId ? this.rows.filter((r) => r.tenantId === filters.tenantId) : this.rows;
    return paginate(applyAuditFilters(all, filters), filters);
  }
}
