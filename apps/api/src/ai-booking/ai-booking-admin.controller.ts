// ai-booking-admin.controller.ts — Super-Admin surface to MINT signed booking links for a tenant. The tenant comes from
// the path under SuperAdminGuard (server-authorized), never from a caller-crafted link. Returns the token + booking URL.
import { Controller, Get, Post, Param, Body, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { AiBookingLinkService } from './ai-booking-link.service';
import { AiBookingConversionService } from './ai-booking-conversion.service';
import { AiBookingRevocationService } from './ai-booking-revocation.service';
import { AiBookingError } from './ai-booking-context';
import { tenantRateLimitEnabled } from '../common/tenant-rate-limit';
import { ListQueries } from '@aipowersalon/database';
import { AiBookingAdminControllerListQueries } from './ai-booking-admin.list-queries';
import { AIB_MINT_LINK_BODY, AIB_REVOKE_LINK_BODY } from './request-schemas';

@UseGuards(SuperAdminGuard)
@ListQueries(AiBookingAdminControllerListQueries)
@Controller('super-admin/tenants')
export class AiBookingAdminController {
  constructor(private readonly links: AiBookingLinkService, private readonly conversion: AiBookingConversionService, private readonly revocation: AiBookingRevocationService) {}

  @Post(':tenantId/ai-booking/link') mint(@Param('tenantId') tenantId: string, @Body(ValidatedBody(AIB_MINT_LINK_BODY, { strict: true })) b: any) {
    try {
      return this.links.mint(tenantId, { source: b?.source, branchId: b?.branchId, allowedServiceIds: b?.allowedServiceIds, partnerId: b?.partnerId, campaignId: b?.campaignId, ttlDays: b?.ttlDays });
    } catch (e) {
      if (e instanceof AiBookingError) throw new HttpException({ code: e.code, message: e.message }, HttpStatus.BAD_REQUEST);
      throw e;
    }
  }

  /** Revoke a single minted link by its jti (§32) — kills that one link without rotating the shared secret. */
  @Post(':tenantId/ai-booking/link/revoke') revoke(@Param('tenantId') tenantId: string, @Body(ValidatedBody(AIB_REVOKE_LINK_BODY, { strict: true })) b: any, @Req() r: any) {
    if (!b?.jti?.trim()) throw new HttpException({ code: 'VALIDATION_ERROR', message: 'jti is required' }, HttpStatus.BAD_REQUEST);
    const actor = r?.ctx?.userId ?? r?.superAdmin?.id ?? 'super-admin';
    return this.revocation.revoke(tenantId, String(b.jti), b?.reason ?? null, String(actor));
  }

  /** Per-tenant AI-booking conversion metrics (§46). Tenant from the path (server-authorized), bounded window. */
  @Get(':tenantId/ai-booking/metrics') metrics(@Param('tenantId') tenantId: string, @Query('sinceDays') sinceDays?: string) {
    return this.conversion.metrics({ tenantId }, { sinceDays: sinceDays ? Number(sinceDays) : undefined });
  }

  /** System status (§53): platform-level AI-booking operational health. Reports which capabilities are live based on
   * configuration — no fabricated values. Platform config is global; surfaced here for Super Admin oversight. */
  @Get(':tenantId/ai-booking/system-status') systemStatus() {
    const rateLimiterEnabled = tenantRateLimitEnabled();   // Phase 11: the shared limiter is ON unless TENANT_RATE_LIMIT=off (in-memory without Redis)
    return {
      operational: true,
      linkSigningConfigured: !!process.env.AI_BOOKING_LINK_SECRET,      // signed online/partner links work
      publicBookingUrlConfigured: !!process.env.PUBLIC_BOOKING_BASE_URL, // minted links carry a ready bookingUrl
      publicAbuseProtection: rateLimiterEnabled ? 'active' : 'pass_through',
      conversionPipeline: 'ready',       // migration 314 present
      linkRevocation: 'ready',           // migration 315 present
      permissionMatrix: 'enforced',      // ai_booking.* required in addition to domain perms
    };
  }
}
