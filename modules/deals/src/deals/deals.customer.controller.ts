// deals.customer.controller.ts — the customer Deals marketplace. Route: customer/deals.
//   Public (guest-browsable, excluded from the session middleware — BUILD_PLAN Phase 5, bug 20): nearby, a deal's page,
//   and "what would I pay" for chosen services. Distance uses branch coordinates + the canonical haversine; the
//   customer's location is never stored or shown to salons. Nothing is fabricated — distance is null without coordinates.
//   Signed in: the deal page with "saved", the saved list (cross-salon), save/unsave, the salon's deals for its own
//   customers (customer app Deals list — it used to read customer_deals, which nothing wrote), and the coupon wallet.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { DEAL_ESTIMATE_BODY } from '../request-schemas';
import { Controller, Get, Post, Delete, Param, Query, Req, Body, HttpException, HttpStatus } from '@nestjs/common';
import { DealsService, DealForbiddenError, DealValidationError, DealConflictError } from './deals.service';
import type { NearbySort } from './deals-nearby-core';
import type { DealContext } from './deals.dto';
import { DealsPublicLimiter } from './deals-public-limiter';
import { ListQueries } from '@aipowersalon/database';
import { DealsCustomerControllerListQueries } from './deals.customer.list-queries';

const userIdFrom = (req: any): string => req?.ctx?.userId || '';
function ctxFrom(req: any): DealContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealForbiddenError) throw new HttpException(e.message, HttpStatus.UNAUTHORIZED);
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}
const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20) : []);

const addrOf = (req: any): string => String(req?.ip || req?.socket?.remoteAddress || '');

@ListQueries(DealsCustomerControllerListQueries)
@Controller('customer/deals')
export class DealsCustomerController {
  /** guest routes only — the signed-in routes are covered by the session and the per-tenant limiter */
  readonly limiter = new DealsPublicLimiter();
  constructor(private readonly svc: DealsService) {}

  private guest(req: any) {
    if (!this.limiter.hit(addrOf(req))) throw new HttpException('Too many requests — try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }

  // GET /customer/deals/nearby?lat=&lng=&radiusMiles=&sort=nearest|best_value|ending_soon|newest&ownerType=&maxPriceCents=&categoryId=&q=
  @Get('nearby')
  nearby(@Req() r: any, @Query() q: any) {
    this.guest(r);
    return this.svc.nearbyDeals({
      lat: num(q?.lat), lng: num(q?.lng), radiusMiles: num(q?.radiusMiles), sort: (q?.sort as NearbySort) || 'nearest',
      ownerType: q?.ownerType ?? null, maxPriceCents: num(q?.maxPriceCents) ?? null, categoryId: q?.categoryId ?? null, search: q?.q ?? null,
    });
  }

  // A deal's page for anyone (guest) — counted as a view (bug 15: the app never opened a deal page, so views stayed 0).
  @Get('public/:id')
  async publicDetail(@Req() r: any, @Param('id') id: string) {
    this.guest(r);
    const deal = await this.svc.publicDeal(id, { countView: this.limiter.firstView(addrOf(r), id) });
    if (!deal) throw new HttpException('Deal not available.', HttpStatus.NOT_FOUND);
    return deal;
  }
  // "What would I pay?" — the deal on the chosen services at catalog prices, through the checkout engine, with reasons.
  @Post('public/:id/estimate') publicEstimate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEAL_ESTIMATE_BODY)) b: any) { this.guest(r); return run(() => this.svc.publicEstimate(id, { serviceIds: ids(b?.serviceIds), date: b?.date, startTime: b?.startTime })); }

  // Signed in. Declared before :id so the literal paths aren't captured as an id.
  @Get('saved') saved(@Req() r: any) { return run(() => this.svc.listSavedDeals(userIdFrom(r))); }
  @Get('salon') salon(@Req() r: any) { return run(() => this.svc.salonDealsForCustomers(ctxFrom(r), 'customer_app')); }
  @Get('wallet') wallet(@Req() r: any) { return run(() => this.svc.wallet(ctxFrom(r))); }
  @Post(':id/save') save(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.saveDeal(userIdFrom(r), id)); }
  @Delete(':id/save') unsave(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.unsaveDeal(userIdFrom(r), id)); }
  @Post(':id/estimate') estimate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEAL_ESTIMATE_BODY)) b: any) {
    const c = ctxFrom(r);
    return run(async () => this.svc.estimate(c, id, { serviceIds: ids(b?.serviceIds), customerId: null, date: b?.date, startTime: b?.startTime, channel: 'customer_app' }));
  }

  @Get(':id')
  async detail(@Req() r: any, @Param('id') id: string) {
    const deal = await this.svc.publicDeal(id, { userId: userIdFrom(r), countView: this.limiter.firstView('u:' + userIdFrom(r), id) });
    if (!deal) throw new HttpException('Deal not available.', HttpStatus.NOT_FOUND);
    return deal;
  }
}
