// audit.controller.ts — read-only HTTP surface for the audit trail. There are deliberately NO write/update/delete
// endpoints: events are produced server-side by services calling AuditService.record(), never by clients.
//  • Tenant view  GET /pos/audit/events       — TenantAuthGuard + RolePermissionGuard, scoped to the caller's tenant.
//  • Platform view GET /super-admin/audit-events — SuperAdminGuard, cross-tenant (optionally filtered by tenantId).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import type { AuditFilters, AuditSeverity, AuditStatus } from './audit.dto';
import { ListQueries } from '@aipowersalon/database';
import { AuditControllerListQueries, SuperAdminAuditControllerListQueries } from './audit.list-queries';

function filtersFrom(q: any): AuditFilters {
  const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    module: q.module || undefined, severity: (q.severity as AuditSeverity) || undefined, status: (q.status as AuditStatus) || undefined,
    actorUserId: q.actorUserId || undefined, resourceType: q.resourceType || undefined, search: q.search || undefined,
    from: q.from || undefined, to: q.to || undefined, page: n(q.page), pageSize: n(q.pageSize),
  };
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(AuditControllerListQueries)
@Controller('pos/audit')
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  // Tenant-scoped audit feed for the tenant Management/Account audit views.
  @Get('events') @RequirePermission('audit.view') events(@Req() r: any, @Query() q: any) {
    return this.svc.list(r?.ctx?.tenantId, filtersFrom(q));
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminAuditControllerListQueries)
@Controller('super-admin/audit-events')
export class SuperAdminAuditController {
  constructor(private readonly svc: AuditService) {}

  // Cross-tenant audit explorer for the Super Admin Audit Logs screen (S22). Optional ?tenantId scopes to one tenant.
  @Get() events(@Query() q: any) {
    return this.svc.listPlatform({ ...filtersFrom(q), tenantId: q.tenantId || undefined });
  }
}
