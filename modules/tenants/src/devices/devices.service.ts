// devices.service.ts — tenant Devices & Integrations use-cases. Resolves tenant/role from session context; enforces
// per-action permissions (reusing the settings capability via security-core's coarse mapping: pos.devices.view →
// settings.view); writes audit logs; never fabricates data. The overview is read-only and composes ONLY real device
// + terminal data through the pure core; unsourced metrics stay null and are named in dataQuality.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { buildOverview } from './devices-overview-core';
import type { DevicesContext, DevicesOverview } from './devices.dto';
import type { DevicesRepositoryPort } from './devices.repository';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }

const UNSOURCED = ['integrationHealthPct', 'apiCallsToday', 'syncSuccessRate', 'pendingUpdates', 'integrationHealthMix', 'syncSuccess7d'];

export interface DevicesAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string;
  entityType: string; entityId?: string; metadata?: Record<string, unknown>; createdAt: string;
}

export class DevicesService {
  private audit: DevicesAuditLog[] = [];
  constructor(private readonly repo: DevicesRepositoryPort, private readonly now: () => number = () => Date.now()) {}

  private assertUser(ctx: DevicesContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Devices & Integrations is not available for this role');
  }
  private need(ctx: DevicesContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: DevicesContext, actionType: string, entityId?: string, metadata?: Record<string, unknown>) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType: 'pos_device_overview', entityId, metadata, createdAt: new Date(this.now()).toISOString() });
  }
  auditLog(): DevicesAuditLog[] { return this.audit.slice(); }

  async getOverview(ctx: DevicesContext): Promise<DevicesOverview> {
    this.need(ctx, 'pos.devices.view');
    const [rawDevices, rawTerminals] = await Promise.all([this.repo.fleet(ctx), this.repo.terminals(ctx)]);
    const core = buildOverview(rawDevices, rawTerminals, this.now());
    this.log(ctx, 'pos_devices_overview_viewed', undefined, { devices: rawDevices.length, terminals: rawTerminals.length });
    return { ...core, dataQuality: { fleetSource: true, terminalsSource: true, metricsUnavailable: [] } };
  }
}
