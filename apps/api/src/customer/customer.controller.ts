import { validateImageUpload } from '@aipowersalon/workforce';
/**
 * customer.controller.ts — customer-facing app HTTP surface (/customer/*). Thin: derives ctx from the session, calls
 * CustomerService, maps CustomerError → HTTP (not_customer → 403, invalid → 400).
 *
 * DATA ADAPTER PENDING (by design): CustomerModule binds the in-memory port (returns no data) because customer↔user
 * resolution has no FK in the schema (`customers` has no `user_id`) — that identity mapping is a prerequisite decision
 * (see INTEGRATION_RUNBOOK). The route contract, auth, and error mapping are real and type-checked.
 */
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Optional, Param, Patch, Post, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CustomerService, CustomerError } from './customer.service';
import { MembershipEnrollService } from '@aipowersalon/memberships';
import { MEDIA_STORAGE } from '@aipowersalon/workforce';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, uploadObjectKey, UPLOAD_POLICIES } from '@aipowersalon/media';
import type { CustomerContext } from './customer.repository';
import { QueueService } from '@aipowersalon/queue';
import { CUSTOMER_ADDRESS_BODY, CUSTOMER_GIFT_CLAIM_BODY, CUSTOMER_GIFT_SEND_BODY, CUSTOMER_HOME_SALON_BODY, CUSTOMER_JOIN_MEMBERSHIP_BODY, CUSTOMER_PROFILE_BODY } from './request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { CodeLookupLimited } from '@aipowersalon/security/nest';   // Phase 14 (Constitution 12): per-caller lookup-by-code limit

function ctxFrom(req: any): CustomerContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CustomerError) {
      if (e.code === 'not_customer') throw new ForbiddenException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('customer')
export class CustomerController {
  constructor(
    private readonly svc: CustomerService,
    private readonly enroll: MembershipEnrollService,
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null,
    @Optional() private readonly queueSvc?: QueueService,
  ) {}

  // Member-facing view of the signed-in customer's own membership (plan, status, member number, next billing, benefits +
  // remaining credits). Resolves customerId from ctx.
  @Get('membership') membership(@Req() r: any) {
    const ctx = ctxFrom(r);
    return run(async () => {
      const customerId = (await this.svc.resolveCustomerId(ctx)) || ctx.userId;
      return this.enroll.membershipView(ctx, customerId);
    });
  }

  @Post('membership/join') join(@Req() r: any, @Body(ValidatedBody(CUSTOMER_JOIN_MEMBERSHIP_BODY, { strict: true })) b: any) {
    const ctx = ctxFrom(r);
    return run(async () => {
      const customerId = (await this.svc.resolveCustomerId(ctx)) || ctx.userId;
      return this.enroll.enroll(ctx, {
        customerId,
        planId: String(b?.planId || ''),
        planVersionId: b?.planVersionId ? String(b.planVersionId) : undefined,
        autoRenewConsent: true,
        channel: 'customer_app',
      });
    });
  }

  @Get('home') home(@Req() r: any) { return run(() => this.svc.getHome(ctxFrom(r))); }
  // Default salon (Oct 3 2026): the customer's home salon location; change it from the salon list / nearby search.
  @Get('me/home-salon') homeSalon(@Req() r: any) { return run(() => this.svc.getHomeSalon(ctxFrom(r))); }
  @Post('me/home-salon') setHomeSalon(@Req() r: any, @Body(ValidatedBody(CUSTOMER_HOME_SALON_BODY, { strict: true })) b: any) { return run(() => this.svc.setHomeSalon(ctxFrom(r), b?.salonId)); }
  @Get('appointments') appointments(@Req() r: any) { return run(() => this.svc.getAppointments(ctxFrom(r))); }
  @Get('service-progress') progress(@Req() r: any) { return run(() => this.svc.getServiceProgress(ctxFrom(r))); }
  @Get('receipts') receipts(@Req() r: any) { return run(() => this.svc.getReceipts(ctxFrom(r))); }
  @Get('loyalty') loyalty(@Req() r: any) { return run(() => this.svc.getLoyalty(ctxFrom(r))); }
  // BUILD_PLAN Phase 6 round 2: + the requested technician (busy or not) and, when busy, who else could take the
  // customer (accept one with POST customer/queue/:id/accept-alternate — the queue module's route). Best-effort.
  @Get('queue') queue(@Req() r: any) {
    const ctx = ctxFrom(r);
    return run(async () => {
      const st: any = await this.svc.getQueue(ctx);
      if (!st?.inQueue || !st.queueItemId) return st;
      let extra: { requestedTechnician: unknown; alternates: unknown[] } = { requestedTechnician: null, alternates: [] };
      if (this.queueSvc) { try { extra = await this.queueSvc.customerQueueExtras(ctx as any, st.queueItemId); } catch { /* the position still shows */ } }
      return { ...st, ...extra };
    });
  }
  @Get('salon') salon(@Req() r: any) { return run(() => this.svc.getSalon(ctxFrom(r))); }
  @Get('addresses') addresses(@Req() r: any) { return run(() => this.svc.getAddresses(ctxFrom(r))); }
  @Post('addresses') addAddress(@Req() r: any, @Body(ValidatedBody(CUSTOMER_ADDRESS_BODY, { strict: true })) b: any) { return run(() => this.svc.addAddress(ctxFrom(r), b)); }
  @Delete('addresses/:id') removeAddress(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.removeAddress(ctxFrom(r), id)); }
  @Post('addresses/:id/default') makeDefaultAddress(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.makeDefaultAddress(ctxFrom(r), id)); }
  @Get('deals') deals(@Req() r: any) { return run(() => this.svc.getDeals(ctxFrom(r))); }
  @Get('referral') referral(@Req() r: any) { return run(() => this.svc.getReferral(ctxFrom(r))); }
  @Get('notifications') notifications(@Req() r: any) { return run(() => this.svc.getNotifications(ctxFrom(r))); }
  @Get('gift-cards') giftCards(@Req() r: any) { return run(() => this.svc.getGiftCards(ctxFrom(r))); }
  @CodeLookupLimited('gift_claim') @Post('gift-cards/claim') claimGiftCard(@Req() r: any, @Body(ValidatedBody(CUSTOMER_GIFT_CLAIM_BODY, { strict: true })) b: any) { return run(() => this.svc.claimGiftCard(ctxFrom(r), b?.token ?? '')); }
  @Post('gift-cards/:id/send') sendGiftCard(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CUSTOMER_GIFT_SEND_BODY, { strict: true })) b: any) { return run(() => this.svc.sendGiftCard(ctxFrom(r), id, b ?? {})); }
  @Post('gift-cards/:id/report-lost') reportLostGiftCard(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.reportLostGiftCard(ctxFrom(r), id)); }
  @Post('notifications/read') readNotifications(@Req() r: any) { return run(() => this.svc.markNotificationsRead(ctxFrom(r))); }
  // BUILD_PLAN Phase 4: /customer/verify/phone/{request,confirm} removed — "verify my current number" lives on the ONE
  // phone route family: POST /customer/profile/phone/verify-current/{request,confirm} (CustomerPhoneAppController).
  @Get('rewards') rewards(@Req() r: any) { return run(() => this.svc.getRewards(ctxFrom(r))); }
  @Post('rewards/:id/redeem') redeem(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.redeemReward(ctxFrom(r), id)); }
  @Post('appointments/:id/check-in') checkIn(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.checkIn(ctxFrom(r), id)); }
  @Post('appointments/:id/cancel') cancelAppointment(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancelAppointment(ctxFrom(r), id)); }
  @Get('profile') getProfile(@Req() r: any) { return run(() => this.svc.getProfile(ctxFrom(r))); }
  @Patch('profile') updateProfile(@Req() r: any, @Body(ValidatedBody(CUSTOMER_PROFILE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.updateProfile(ctxFrom(r), { phone: b?.phone, email: b?.email, marketingOptIn: b?.marketingOptIn, smsOptIn: b?.smsOptIn, emailOptIn: b?.emailOptIn }));
  }
  @Post('profile/avatar')
  @UseInterceptors(FilesInterceptor('file', 1, { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.avatar.maxBytes } }))   // Phase 12: the avatar policy 10 MB, was 20 MB read into memory, then refused at 10
  async uploadAvatar(@Req() r: any, @UploadedFiles() files: any[]) {
    return run(async () => {
      const f = (files ?? [])[0];
      if (!f) throw new CustomerError('invalid', 'No image provided.');
      if (!this.storage) throw new CustomerError('invalid', 'Media storage is not configured.');
      // Sep 2026 merge: the BYTES decide the type (a renamed .html is refused) and the extension comes from the sniffed type
      const v: any = validateImageUpload(f.buffer, 'avatar'); if (!v.ok) throw new CustomerError('invalid', v.reason || 'That file is not a supported image.');
      const ext = v.ext;
      const ctx = ctxFrom(r);
      const customerId = await this.svc['requireCustomer'](ctx);
      // Phase 12 (#34): the one upload policy — EXIF (GPS) stripped from this public picture, a tenant-scoped random key
      const up = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: f.buffer, filename: f.originalname, declaredType: f.mimetype, tenantId: ctx.tenantId ?? null, quotaReserved: true });
      const key = uploadObjectKey({ tenantId: ctx.tenantId ?? null, area: 'avatars', owner: ['customer', String(customerId)], ext: up.ext || ext });
      
      const oldProfile = await this.svc.getProfile(ctx);
      if (oldProfile?.avatarUrl) {
        const raw = oldProfile.avatarUrl;
        const oldKey = raw.includes('uploads/')
          ? raw.substring(raw.indexOf('uploads/') + 8)
          : raw.includes('tenants/')
            ? raw.substring(raw.indexOf('tenants/'))
            : raw.split('/').pop() || raw;
        await this.storage.remove(oldKey).catch(() => {});
      }

      const { url } = await this.storage.put(key, up.bytes);
      await this.svc.setAvatar(ctx, key);
      return { url };
    });
  }
}
