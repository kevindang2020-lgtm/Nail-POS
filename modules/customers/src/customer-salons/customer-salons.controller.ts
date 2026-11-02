// customer-salons.controller.ts — PUBLIC discovery routes (§16/§24: public salon listing info only; rate-limited per
// IP exactly like the public website intake). Excluded from the tenant middleware in app.module.
import { AnonRateLimit } from '@aipowersalon/security/nest';   // Security Deep Scan §28/§43/§44: per-IP limit on public routes
import { Controller, Get, Header, HttpException, Param, Query, Req } from '@nestjs/common';
import { CustomerSalonsService, SalonSearchError } from './customer-salons.service';
import { rateLimitDecision } from '@aipowersalon/auth';
import { ListQueries } from '@aipowersalon/database';
import { CustomerSalonsControllerListQueries } from './customer-salons.list-queries';

const hits = new Map<string, number[]>();
/** 30 requests/min per IP, 5-minute lock — same rateLimitDecision core the login + public intake use. */
function limited(ip: string): boolean {
  const now = Date.now();
  const history = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  const d = rateLimitDecision(history, now, { windowMs: 60_000, maxFailures: 30, lockMs: 5 * 60_000 });
  if (!d.allowed) { hits.set(ip, history); return true; }
  history.push(now); hits.set(ip, history);
  return false;
}
function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e) => {
    if (e instanceof SalonSearchError) throw new HttpException({ ok: false, code: e.code, message: e.message }, e.code === 'not_found' ? 404 : e.code === 'unavailable' ? 503 : 400);
    throw e;
  });
}

@ListQueries(CustomerSalonsControllerListQueries)
@Controller('customer/salons')
export class CustomerSalonsController {
  constructor(private readonly svc: CustomerSalonsService) {}

  @Get('nearby') @AnonRateLimit(30, 60_000, { bucket: 'customer-salons' })   // §28/§44: across replicas (limited() is per instance)
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=120')
  nearby(@Req() r: any, @Query() q: any) {
    if (limited(String(r?.ip || 'unknown'))) throw new HttpException({ ok: false, code: 'rate_limited', message: 'Too many searches — try again in a few minutes.' }, 429);
    return run(() => this.svc.nearby({
      lat: q?.lat !== undefined ? Number(q.lat) : undefined, lng: q?.lng !== undefined ? Number(q.lng) : undefined,
      radiusMiles: q?.radiusMiles !== undefined ? Number(q.radiusMiles) : undefined,
      city: q?.city ? String(q.city) : undefined, state: q?.state ? String(q.state) : undefined,
      zip: q?.zip ? String(q.zip) : undefined, searchText: q?.searchText ? String(q.searchText) : undefined,
      limit: q?.limit !== undefined ? Number(q.limit) : undefined, cursor: q?.cursor ? String(q.cursor) : undefined,   // B-28: the browse page (the interceptor clamps limit)
    }));
  }

  @Get(':salonId') @AnonRateLimit(30, 60_000, { bucket: 'customer-salons' })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  detail(@Req() r: any, @Param('salonId') salonId: string) {
    if (limited(String(r?.ip || 'unknown'))) throw new HttpException({ ok: false, code: 'rate_limited', message: 'Too many searches — try again in a few minutes.' }, 429);
    return run(() => this.svc.detail(salonId));
  }

  @Get(':salonId/services') @AnonRateLimit(30, 60_000, { bucket: 'customer-salons' })
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  services(@Req() r: any, @Param('salonId') salonId: string) {
    if (limited(String(r?.ip || 'unknown'))) throw new HttpException({ ok: false, code: 'rate_limited', message: 'Too many searches — try again in a few minutes.' }, 429);
    return run(() => this.svc.services(salonId));
  }
}
