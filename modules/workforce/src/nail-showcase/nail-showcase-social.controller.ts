import { validateImageUpload } from '../tech-profile/tech-profile-core';
/**
 * nail-showcase-social.controller.ts — customer-facing HTTP surface for NailShowcase Social Ranking. Thin: derives ctx
 * from the session, calls the social + ranking services, maps NailShowcaseSocialError → HTTP. Mounted under /customer.
 * Routes: /customer/social/* (profiles, follows, follow-lists, report, avatar) and /customer/nail-showcase/leaderboard
 * + /customer/nail-showcase/me/rank.
 */
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { NailShowcaseSocialService } from './nail-showcase-social.service';
import { NailShowcaseRankingService } from './nail-showcase-ranking.service';
import { MEDIA_STORAGE } from '../tech-profile/tech-profile.service';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, uploadObjectKey, UPLOAD_POLICIES } from '@aipowersalon/media';
import type { NailShowcaseContext } from './nail-showcase.repository';
import { nsValidatePhotoFile } from './nail-showcase.dto';
import { NailShowcaseSocialError, nsClampLimit, nsNormalizeScope, nsNormalizePeriod } from './nail-showcase-social.dto';
import { ListQueries } from '@aipowersalon/database';
import { NailShowcaseSocialControllerListQueries } from './nail-showcase-social.list-queries';
import { NS_REPORT_BODY, SOCIAL_AVATAR_BODY, SOCIAL_PROFILE_BODY } from '../request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

function ctxFrom(req: any): NailShowcaseContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NailShowcaseSocialError) {
      if (e.code === 'not_customer' || e.code === 'forbidden' || e.code === 'private') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(NailShowcaseSocialControllerListQueries)
@Controller('customer')
export class NailShowcaseSocialController {
  constructor(
    private readonly social: NailShowcaseSocialService,
    private readonly ranking: NailShowcaseRankingService,
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null,
  ) {}

  private readonly EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  // ---- my profile ----
  @Get('social/me/profile') myProfile(@Req() r: any) { return run(() => this.social.getMyProfile(ctxFrom(r))); }
  @Patch('social/me/profile') updateMyProfile(@Req() r: any, @Body(ValidatedBody(SOCIAL_PROFILE_BODY)) b: any) {
    return run(() => this.social.updateMyProfile(ctxFrom(r), {
      publicDisplayName: b?.publicDisplayName, bio: b?.bio, profileVisibility: b?.profileVisibility,
      showRankOnProfile: b?.showRankOnProfile, showPostsOnProfile: b?.showPostsOnProfile, allowFollowers: b?.allowFollowers,
    }));
  }

  // ---- avatar (real multipart upload, reusing the showcase media storage) ----
  @Post('social/me/avatar')
  @UseInterceptors(FilesInterceptor('file', 1, { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.avatar.maxBytes } }))   // Phase 12: an avatar is 10 MB, was the 50 MB video cap
  async avatar(@Req() r: any, @UploadedFiles() files: any[], @Body(ValidatedBody(SOCIAL_AVATAR_BODY)) b: any) {
    const ctx = ctxFrom(r);
    return run(async () => {
      const f = (files ?? [])[0];
      if (f) {
        if (!this.storage) throw new NailShowcaseSocialError('invalid', 'Media storage is not configured.');
        const v = nsValidatePhotoFile({ mimetype: f?.mimetype, size: f?.size });
        if (!v.ok) throw new NailShowcaseSocialError('invalid', v.reason!);
        // Sep 2026 merge: an avatar is an IMAGE decided by its bytes (the claimed type allowed a video or anything labelled one)
        const img: any = validateImageUpload(f.buffer, 'avatar');
        if (!img?.ok) throw new NailShowcaseSocialError('invalid', 'Your profile photo must be a JPG, PNG or WEBP image.');
        // Phase 12 (#34): the avatar policy — EXIF (GPS) stripped from this public picture; server-chosen random key
        const up = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: f.buffer, filename: f?.originalname, declaredType: f?.mimetype, tenantId: ctx.tenantId || null, quotaReserved: true });
        const key = uploadObjectKey({ tenantId: ctx.tenantId || null, area: 'social-avatars', owner: ['customer', ctx.userId], ext: up.ext || img.ext });
        await this.storage.put(key, up.bytes);
        return this.social.setAvatar(ctx, key);
      }
      const url = (b?.avatarUrl ?? '').trim();
      if (!url) throw new NailShowcaseSocialError('invalid', 'No avatar image provided.');
      return this.social.setAvatar(ctx, url);
    });
  }

  // ---- another customer's profile ----
  @Get('social/profile/:customerId') profile(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.getPublicProfile(ctxFrom(r), id)); }
  @Get('social/profile/:customerId/followers') followers(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.followers(ctxFrom(r), id)); }
  @Get('social/profile/:customerId/following') following(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.following(ctxFrom(r), id)); }
  @Get('social/profile/:customerId/posts') profilePosts(@Req() r: any, @Param('customerId') id: string, @Query('limit') limit?: string) { return run(() => this.social.getProfilePosts(ctxFrom(r), id, limit ? Number(limit) : 30)); }
  @Post('social/profile/:customerId/report') report(@Req() r: any, @Param('customerId') id: string, @Body(ValidatedBody(NS_REPORT_BODY)) b: any) { return run(() => this.social.reportProfile(ctxFrom(r), id, b?.reason ?? 'other', b?.details)); }

  // ---- follow / unfollow ----
  @Post('social/follow/:customerId') follow(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.follow(ctxFrom(r), id)); }
  @Delete('social/follow/:customerId') unfollow(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.unfollow(ctxFrom(r), id)); }
  @Post('social/block/:customerId') block(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.block(ctxFrom(r), id)); }
  @Delete('social/block/:customerId') unblock(@Req() r: any, @Param('customerId') id: string) { return run(() => this.social.unblock(ctxFrom(r), id)); }
  @Get('social/me/blocked') blocked(@Req() r: any) { return run(() => this.social.listBlocked(ctxFrom(r))); }

  // ---- following feed ----
  @Get('social/me/following-feed') followingFeed(@Req() r: any, @Query('limit') limit?: string) { return run(() => this.social.followingFeed(ctxFrom(r), limit ? Number(limit) : 30)); }

  // ---- leaderboard + my rank ----
  @Get('nail-showcase/leaderboard') leaderboard(@Req() r: any, @Query() q: any) {
    const ctx = ctxFrom(r);
    const scope = nsNormalizeScope(q?.scope);
    const tenantId = scope === 'platform' ? null : (q?.salonId || ctx.tenantId || null);
    return run(() => this.ranking.leaderboard(ctx.userId ?? null, { limit: nsClampLimit(q?.limit), period: nsNormalizePeriod(q?.period), scope, tenantId, branchId: ctx.branchId || null }));
  }
  @Get('nail-showcase/me/rank') myRank(@Req() r: any) { const ctx = ctxFrom(r); return run(() => this.ranking.myRank(ctx.userId, ctx.tenantId ?? null)); }
}
