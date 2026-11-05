// super-admin-locations.controller.ts — SuperAdminGuard-only platform location verification (§9).
import { Body, Controller, Get, HttpException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminLocationService, SaLocationError } from './super-admin-location.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminLocationsControllerListQueries } from './super-admin-locations.list-queries';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { SA_LOCATION_REASON_BODY, SA_MAP_PIN_BODY } from '../request-schemas';

function actor(req: any) { const c = req?.ctx || req?.user || {}; return { userId: c.userId || 'super_admin', role: c.role || 'SUPER_ADMIN' }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof SaLocationError) throw new HttpException({ ok: false, message: e.message }, e.status); throw e; }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminLocationsControllerListQueries)
@Controller('super-admin/tenant-locations')
export class SuperAdminLocationsController {
  constructor(private readonly svc: SuperAdminLocationService) {}

  @Get('') list(@Query() q: any) { return run(() => this.svc.list({ search: q?.search, status: q?.status })); }
  @Get('summary') summary() { return run(() => this.svc.summary()); }
  @Get(':id') detail(@Param('id') id: string) { return run(() => this.svc.detail(id)); }
  @Post(':id/verify') verify(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.verify(actor(r), id)); }
  @Post(':id/reject') reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_LOCATION_REASON_BODY)) b: any) { return run(() => this.svc.reject(actor(r), id, b?.reason)); }
  @Post(':id/suspend') suspend(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_LOCATION_REASON_BODY)) b: any) { return run(() => this.svc.suspend(actor(r), id, b?.reason)); }
  @Patch(':id/map-pin') mapPin(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(SA_MAP_PIN_BODY)) b: any) { return run(() => this.svc.correctPin(actor(r), id, Number(b?.latitude), Number(b?.longitude))); }
}
