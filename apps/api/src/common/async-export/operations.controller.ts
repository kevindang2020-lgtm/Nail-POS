// operations.controller.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the status, list and download routes of the
// ONE async operation contract, one controller per realm. Each realm reads only its own operations, and only in its own
// salon (another salon's — or another realm's — operation is 404, never 403). Inside a salon, an operation is readable by
// the person who asked for it, or by someone who holds that export's own permission; a customer's only by that customer.
// The download streams the file from the PRIVATE store with the same authorization; nothing is ever a public URL.
import { Controller, Get, HttpException, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CustomerAuthGuard, RequirePermission, SuperAdminGuard, TenantAuthGuard } from '@aipowersalon/permissions/guards';
import { ASYNC_OPERATION_STATUSES, type AsyncOperationList, type AsyncOperationStatus, type OperationId, type OperationRealm } from '@aipowersalon/api-contracts';
import { ListQuery, type ListQuerySpec } from '@aipowersalon/database';
import { AsyncExportService, OperationHttpError } from './async-export.service';
import { realmAllowsRole } from './async-export.core';

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof OperationHttpError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
/** BUILD_PLAN Phase 12 (#21–#23): the operations list — the caller's own, newest first; ?status= / ?kind= narrow it. */
const OPERATIONS_LIST: ListQuerySpec = {
  filters: { status: { type: 'enum', values: ASYNC_OPERATION_STATUSES }, kind: { type: 'text', maxLength: 120 } },
  sorts: { createdAt: null }, defaultSort: '-createdAt', search: false, maxLimit: 200, defaultLimit: 50,
};
const lim = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined; };

abstract class OperationsRoutes {
  protected abstract readonly realm: OperationRealm;
  constructor(protected readonly svc: AsyncExportService) {}
  private assertRealm(r: any) { if (!realmAllowsRole(this.realm, r?.ctx?.role)) throw new OperationHttpError(404, 'RESOURCE_NOT_FOUND', 'That export could not be found.'); }
  protected listFor(r: any, limit: unknown, status?: string, kind?: string) { return guarded(async () => { this.assertRealm(r); return this.svc.list(r.ctx, this.realm, lim(limit), { status, kind }); }); }
  protected statusFor(r: any, id: string) { return guarded(async () => { this.assertRealm(r); return this.svc.status(r.ctx, this.realm, id); }); }
  protected async downloadFor(r: any, id: string, res: Response) {
    const f = await guarded(async () => { this.assertRealm(r); return this.svc.download(r.ctx, this.realm, id); });
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename.replace(/"/g, '')}"`);
    res.setHeader('Content-Length', String(f.bytes.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(f.bytes);
  }
}

@UseGuards(TenantAuthGuard)
@Controller('pos/operations')
export class PosOperationsController extends OperationsRoutes {
  protected readonly realm = 'pos' as const;
  constructor(@Inject(AsyncExportService) svc: AsyncExportService) { super(svc); }
  @RequirePermission('self.operations.view') @ListQuery(OPERATIONS_LIST) @Get() list(@Req() r: any, @Query('limit') limit?: string, @Query('status') status?: string, @Query('kind') kind?: string): Promise<AsyncOperationList> { return this.listFor(r, limit, status, kind); }
  @RequirePermission('self.operations.view') @Get(':id') status(@Req() r: any, @Param('id') id: OperationId): Promise<AsyncOperationStatus> { return this.statusFor(r, id); }
  @RequirePermission('self.operations.view') @Get(':id/download') download(@Req() r: any, @Param('id') id: OperationId, @Res() res: Response): Promise<void> { return this.downloadFor(r, id, res); }
}

@UseGuards(TenantAuthGuard)
@Controller('owner/operations')
export class OwnerOperationsController extends OperationsRoutes {
  protected readonly realm = 'owner' as const;
  constructor(@Inject(AsyncExportService) svc: AsyncExportService) { super(svc); }
  @RequirePermission('self.operations.view') @ListQuery(OPERATIONS_LIST) @Get() list(@Req() r: any, @Query('limit') limit?: string, @Query('status') status?: string, @Query('kind') kind?: string): Promise<AsyncOperationList> { return this.listFor(r, limit, status, kind); }
  @RequirePermission('self.operations.view') @Get(':id') status(@Req() r: any, @Param('id') id: OperationId): Promise<AsyncOperationStatus> { return this.statusFor(r, id); }
  @RequirePermission('self.operations.view') @Get(':id/download') download(@Req() r: any, @Param('id') id: OperationId, @Res() res: Response): Promise<void> { return this.downloadFor(r, id, res); }
}

@UseGuards(TenantAuthGuard)
@Controller('tech/operations')
export class TechOperationsController extends OperationsRoutes {
  protected readonly realm = 'tech' as const;
  constructor(@Inject(AsyncExportService) svc: AsyncExportService) { super(svc); }
  @RequirePermission('self.operations.view') @ListQuery(OPERATIONS_LIST) @Get() list(@Req() r: any, @Query('limit') limit?: string, @Query('status') status?: string, @Query('kind') kind?: string): Promise<AsyncOperationList> { return this.listFor(r, limit, status, kind); }
  @RequirePermission('self.operations.view') @Get(':id') status(@Req() r: any, @Param('id') id: OperationId): Promise<AsyncOperationStatus> { return this.statusFor(r, id); }
  @RequirePermission('self.operations.view') @Get(':id/download') download(@Req() r: any, @Param('id') id: OperationId, @Res() res: Response): Promise<void> { return this.downloadFor(r, id, res); }
}

/** Platform: the derived key (PLATFORM_PATH_DOMAIN 'operations' → super_admin.tenants.view, which every platform role
 *  holds); which operation a platform user may read is the service's check (theirs, or one whose export key they hold). */
@UseGuards(SuperAdminGuard)
@Controller('super-admin/operations')
export class SuperAdminOperationsController extends OperationsRoutes {
  protected readonly realm = 'super-admin' as const;
  constructor(@Inject(AsyncExportService) svc: AsyncExportService) { super(svc); }
  @ListQuery(OPERATIONS_LIST) @Get() list(@Req() r: any, @Query('limit') limit?: string, @Query('status') status?: string, @Query('kind') kind?: string): Promise<AsyncOperationList> { return this.listFor(r, limit, status, kind); }
  @Get(':id') status(@Req() r: any, @Param('id') id: OperationId): Promise<AsyncOperationStatus> { return this.statusFor(r, id); }
  @Get(':id/download') download(@Req() r: any, @Param('id') id: OperationId, @Res() res: Response): Promise<void> { return this.downloadFor(r, id, res); }
}

@UseGuards(CustomerAuthGuard)
@Controller('customer/operations')
export class CustomerOperationsController extends OperationsRoutes {
  protected readonly realm = 'customer' as const;
  constructor(@Inject(AsyncExportService) svc: AsyncExportService) { super(svc); }
  @ListQuery(OPERATIONS_LIST) @Get() list(@Req() r: any, @Query('limit') limit?: string, @Query('status') status?: string, @Query('kind') kind?: string): Promise<AsyncOperationList> { return this.listFor(r, limit, status, kind); }
  @Get(':id') status(@Req() r: any, @Param('id') id: OperationId): Promise<AsyncOperationStatus> { return this.statusFor(r, id); }
  @Get(':id/download') download(@Req() r: any, @Param('id') id: OperationId, @Res() res: Response): Promise<void> { return this.downloadFor(r, id, res); }
}

export const OPERATIONS_CONTROLLERS = [PosOperationsController, OwnerOperationsController, TechOperationsController, SuperAdminOperationsController, CustomerOperationsController];
