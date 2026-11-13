// device-fleet.controller.ts — SUNMI batch 8 (Nov 9 2026): `/pos/device-fleet/*`, the read model behind Reception POS,
// Check-In Kiosks, iPads & Tablets, Receipt Devices, Device Assignments and Device Health. pos.devices.view (the same key as
// the Devices Overview). Read-only: device actions stay on their owning endpoints (displays / registers / terminals).
// extras Tablets 11: GET export (pos.devices.export → owners and managers) — the redacted inventory + health CSV, audited.
import { ListQuery } from '@aipowersalon/database';
import type { DfSummary, DfListResponse, DfHistoryResponse, DfCheckResponse, DfAlertsResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { Body, Controller, Get, Header, HttpException, HttpStatus, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DeviceFleetCenter, DeviceFleetError, DF_CLASSES, DF_STATUSES, exportDeviceFleetCsv, type DfCtx } from './device-fleet-center';

export const DEVICE_FLEET_CENTER = 'DeviceFleetCenter';
export const DF_CHECK_BODY: BodySchema = S.object({ class: S.enumOf([...DF_CLASSES]) }, ['class']);
const FILTERS = { class: { type: 'enum', values: DF_CLASSES }, status: { type: 'enum', values: DF_STATUSES }, branchId: { type: 'uuid' }, dateField: { type: 'enum', values: ['created', 'updated', 'last_seen'] } } as const;
const LIST = { filters: FILTERS, sorts: { newest: null, last_seen: null, name: null, status: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;
const HIST = { filters: { class: { type: 'enum', values: DF_CLASSES }, deviceId: { type: 'id' } }, sorts: { newest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const;

function ctxFrom(req: any): DfCtx { const c = req?.ctx || {}; return { tenantId: String(c.tenantId || ''), branchId: String(c.branchId || ''), userId: c.userId ?? null, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof DeviceFleetError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/device-fleet')
export class DeviceFleetController {
  constructor(@Inject(DEVICE_FLEET_CENTER) private readonly df: DeviceFleetCenter | null) {}
  private r(): DeviceFleetCenter { if (!this.df) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'The device fleet needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.df; }

  @Get('summary') @RequirePermission('pos.devices.view')
  @ListQuery({ filters: { class: FILTERS.class } } as const)
  summary(@Req() q: any, @Query() f: any): Promise<DfSummary> { return run(() => this.r().summary(ctxFrom(q), f?.class)); }

  @Get('devices') @RequirePermission('pos.devices.view')
  @ListQuery(LIST)
  list(@Req() q: any, @Query() f: any): Promise<DfListResponse> { return run(() => this.r().list(ctxFrom(q), f ?? {})); }

  @Get('history') @RequirePermission('pos.devices.view')
  @ListQuery(HIST)
  history(@Req() q: any, @Query() f: any): Promise<DfHistoryResponse> { return run(() => this.r().history(ctxFrom(q), f ?? {})); }

  /** extras Tablets 11 — Safe Export & Evidence Bundle: the filtered inventory (every page) + the read-only health check as one
   *  redacted CSV with a provenance block; never a token, pairing code, processor id or customer data; one audit row */
  @AsyncExport({ kind: 'pos.device-fleet.export' }) @Get('export') @RequirePermission('pos.devices.export') @ListQuery(LIST)
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="device-inventory.csv"')
  exportFile(@Req() q: any, @Query() f: any): Promise<string> { return run(() => exportDeviceFleetCsv(this.r(), ctxFrom(q), f ?? {})); }
  /** Device Integration Logs 05: the routed (deduplicated) device / integration alerts — the logs page's list. Reading it
   *  may run the router once a minute (it writes only the salon's own alert feed, never a device or a log). */
  @Get('alerts') @RequirePermission('pos.logs.view')
  @ListQuery({ filters: { status: { type: 'enum', values: ['open', 'closed', 'all'] } }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const)
  alerts(@Req() q: any, @Query() f: any): Promise<DfAlertsResponse> { return run(() => this.r().alerts(ctxFrom(q), { status: f?.status, page: f?.page, pageSize: f?.pageSize })); }

  @Post('check') @RequirePermission('pos.devices.view')
  check(@Req() q: any, @Body(ValidatedBody(DF_CHECK_BODY, { strict: true })) b: { class: string }): Promise<DfCheckResponse> { return run(() => this.r().check(ctxFrom(q), b.class)); }
}
