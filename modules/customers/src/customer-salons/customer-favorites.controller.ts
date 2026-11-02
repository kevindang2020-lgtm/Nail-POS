// customer-favorites.controller.ts — AUTHED favorites routes (§21): rides the normal customer session + tenant
// middleware (NOT excluded). The user id comes from the session principal; salon ids are public directory ids.
import { Controller, Delete, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import { CustomerSalonsService, SalonSearchError } from './customer-salons.service';

function userIdFrom(req: any): string {
  const id = req?.ctx?.userId;
  if (!id) throw new HttpException({ ok: false, message: 'Sign in to manage favorites.' }, 401);
  return String(id);
}
function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof SalonSearchError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.code === 'not_found' ? 404 : 400);
    throw e;
  });
}

@Controller('customer/me/favorite-salons')
export class CustomerFavoritesController {
  constructor(private readonly svc: CustomerSalonsService) {}
  @Get() list(@Req() r: any) { return run(() => this.svc.listFavorites(userIdFrom(r))); }
  @Post(':salonId') add(@Req() r: any, @Param('salonId') salonId: string) { return run(() => this.svc.addFavorite(userIdFrom(r), salonId)); }
  @Delete(':salonId') remove(@Req() r: any, @Param('salonId') salonId: string) { return run(() => this.svc.removeFavorite(userIdFrom(r), salonId)); }
}
