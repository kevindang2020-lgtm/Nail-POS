// hardware-packages.controller.ts + module — Super-Admin Hardware Packages HTTP surface under
// /super-admin/hardware-packages (+ the tenant detail card at /super-admin/tenants/:tenantId/hardware), guarded so only
// platform super-admins reach it. HardwareError maps to 404 / 409 / 400.
import { safeInet, DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { Body, Controller, Get, Header, Module, NotFoundException, ConflictException, BadRequestException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { HardwarePackagesService, HardwareError, type AdminCtx, type HwQuery } from './hardware-packages.service';
import { InMemoryHardwarePackagesRepo, KyselyHardwarePackagesRepo, type HardwarePackagesRepo } from './hardware-packages.repository';
import { HardwarePackagesControllerListQueries } from './super-admin-hardware-packages.module.list-queries';
import { HW_CREATE_BODY, HW_DEVICES_BODY, HW_NOTE_BODY, HW_PAYMENT_STATUS_BODY, HW_REASON_BODY, HW_STATUS_BODY, HW_TRACKING_BODY, HW_UPDATE_BODY } from '../request-schemas-oversight';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { return { userId: req?.ctx?.userId ?? req?.user?.id, ip: safeInet(req?.ip) ?? undefined }; }
function queryFrom(q: any): HwQuery {
  return { search: q?.search, status: q?.status, paymentStatus: q?.paymentStatus, packageType: q?.packageType, carrier: q?.carrier, dateFrom: q?.dateFrom, dateTo: q?.dateTo, tenantId: q?.tenantId, sortBy: q?.sortBy, sortDirection: q?.sortDirection === 'asc' ? 'asc' : 'desc', page: q?.page ? +q.page : 1, limit: q?.limit ? +q.limit : 10 };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof HardwareError) { if (e.code === 'not_found') throw new NotFoundException(e.message); if (e.code === 'conflict') throw new ConflictException(e.message); throw new BadRequestException(e.message); }
    throw e;
  }
}

@ListQueries(HardwarePackagesControllerListQueries)
@Controller('super-admin/hardware-packages')
@UseGuards(SuperAdminGuard)
export class HardwarePackagesController {
  constructor(private readonly svc: HardwarePackagesService) {}

  @Get('state') state(@Query() q: any) { return run(() => this.svc.state(queryFrom(q))); }
  @Get('summary') summary() { return run(() => this.svc.summary()); }
  @Get('status-breakdown') breakdown() { return run(() => this.svc.summary()); }
  @Get('package-types') types() { return run(() => this.svc.summary()); }
  @Get('activity/recent') activity(@Query() q: any) { return run(() => this.svc.recentActivity(q?.limit ? +q.limit : 10)); }
  @Get('events') events(@Query() q: any) { return run(() => this.svc.events(q?.limit ? +q.limit : 10)); }
  @Get('tenants') tenants(@Query() q: any) { return run(() => this.svc.listTenants(q?.search)); }

  @AsyncExport({ kind: 'super-admin.hardware-packages.export' }) @Get('export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="hardware-packages.csv"')
  async export(@Query() q: any) { const { packages } = await this.svc.list({ ...queryFrom(q), limit: 100000, page: 1 }); const cols = ['id', 'salonName', 'salonCode', 'ownerName', 'city', 'state', 'packageName', 'packageType', 'status', 'paymentStatus', 'shippingCarrier', 'trackingNumber', 'updatedAt']; const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.join(','), ...packages.map((r: any) => cols.map((c) => esc(r[c])).join(','))].join('\n'); }

  @Get() list(@Query() q: any) { return run(() => this.svc.list(queryFrom(q))); }
  @Post() create(@Req() r: any, @Body(ValidatedBody(HW_CREATE_BODY)) b: any) { return run(() => this.svc.create(ctxFrom(r), b || {})); }

  @Get(':packageId') detail(@Param('packageId') id: string) { return run(() => this.svc.detail(id)); }
  @Patch(':packageId') update(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_UPDATE_BODY)) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b || {})); }
  @Patch(':packageId/status') status(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_STATUS_BODY)) b: any) { return run(() => this.svc.setStatus(ctxFrom(r), id, String(b?.status ?? ''), !!b?.force)); }
  @Patch(':packageId/payment-status') payment(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_PAYMENT_STATUS_BODY)) b: any) { return run(() => this.svc.setPaymentStatus(ctxFrom(r), id, String(b?.paymentStatus ?? ''))); }
  @Patch(':packageId/tracking') tracking(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_TRACKING_BODY)) b: any) { return run(() => this.svc.updateTracking(ctxFrom(r), id, b || {})); }
  @Post(':packageId/devices') devices(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_DEVICES_BODY)) b: any) { return run(() => this.svc.addDevices(ctxFrom(r), id, Array.isArray(b?.devices) ? b.devices : Array.isArray(b) ? b : [b])); }
  @Post(':packageId/notes') note(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_NOTE_BODY)) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, String(b?.note ?? ''), b?.isInternal !== false)); }
  @Post(':packageId/cancel') cancel(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_REASON_BODY)) b: any) { return run(() => this.svc.cancel(ctxFrom(r), id, b?.reason)); }
  @Post(':packageId/return') ret(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(HW_REASON_BODY)) b: any) { return run(() => this.svc.return_(ctxFrom(r), id, b?.reason)); }
}

@Controller('super-admin/tenants')
@UseGuards(SuperAdminGuard)
export class TenantHardwareController {
  constructor(private readonly svc: HardwarePackagesService) {}
  @Get(':tenantId/hardware') tenantHardware(@Param('tenantId') id: string) { return run(() => this.svc.tenantHardware(id)); }
}

@Module({
  controllers: [HardwarePackagesController, TenantHardwareController],
  providers: [
    { provide: 'HardwarePackagesRepo', useFactory: (db: AppDatabase): HardwarePackagesRepo => (db ? new KyselyHardwarePackagesRepo(db as any) : new InMemoryHardwarePackagesRepo()), inject: [DATABASE] },
    { provide: HardwarePackagesService, useFactory: (repo: HardwarePackagesRepo, db: AppDatabase) => new HardwarePackagesService(repo, db), inject: ['HardwarePackagesRepo', DATABASE] },
  ],
  exports: [HardwarePackagesService],
})
export class SuperAdminHardwarePackagesModule {}
