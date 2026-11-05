import { validateImageUpload } from '../tech-profile/tech-profile-core';
/**
 * nail-showcase.controller.ts — customer-facing NailShowcase HTTP surface. Thin: derives ctx from the session, calls
 * NailShowcaseService, maps NailShowcaseError → HTTP. Mounted under /customer so it can also expose the ticket-linked
 * verified-upload endpoints (/customer/tickets/:ticketId/nail-showcase-*) the spec specifies.
 */
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, HttpException, HttpStatus, Inject, NotFoundException, Optional, Param, Patch, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { NailShowcaseService, NailShowcaseError } from './nail-showcase.service';
import { MEDIA_STORAGE } from '../tech-profile/tech-profile.service';
import type { MediaStorage } from '@aipowersalon/media';
import { acceptUpload, uploadObjectKey, UPLOAD_POLICIES } from '@aipowersalon/media';
import type { NailShowcaseContext } from './nail-showcase.repository';
import { nsValidatePhotoFile, NS_MAX_PHOTOS, type NSFeedQuery, type NSReactionType } from './nail-showcase.dto';
import { ListQueries } from '@aipowersalon/database';
import { NailShowcaseCustomerControllerListQueries } from './nail-showcase.list-queries';
import { NS_COMMENT_BODY, NS_PHOTOS_BODY, NS_POST_BODY, NS_POST_UPDATE_BODY, NS_REACTION_BODY, NS_REPORT_BODY } from '../request-schemas';
import { ValidatedBody } from '@aipowersalon/permissions/guards';

function ctxFrom(req: any): NailShowcaseContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof NailShowcaseError) {
      if (e.code === 'not_customer' || e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'not_eligible') throw new ConflictException(e.message);
      if (e.code === 'rate_limited') throw new HttpException(e.message, HttpStatus.TOO_MANY_REQUESTS);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@ListQueries(NailShowcaseCustomerControllerListQueries)
@Controller('customer')
export class NailShowcaseCustomerController {
  constructor(private readonly svc: NailShowcaseService, @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null) {}

  private readonly EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  // Real multipart upload: validate each file, write its bytes to media storage under a tenant/branch/customer/post key,
  // then hand the resulting URLs to the service. Falls back to imageUrl descriptors when no binary files are sent
  // (programmatic/verified callers). thumbnail_url mirrors image_url: the platform stores originals (no server-side image
  // processing lib is in the stack — tech-profile portfolio photos behave identically), so thumbnailing is a follow-up.
  private async ingestPhotos(ctx: NailShowcaseContext, postId: string, files: any[], b: any) {
    if (files.length) {
      if (!this.storage) throw new NailShowcaseError('invalid', 'Media storage is not configured.');
      if (files.length > NS_MAX_PHOTOS) throw new NailShowcaseError('invalid', `Upload at most ${NS_MAX_PHOTOS} photos at a time.`);
      const descriptors: { imageUrl: string; thumbnailUrl?: string | null; caption?: string | null }[] = [];
      for (const f of files) {
        const v = nsValidatePhotoFile({ mimetype: f?.mimetype, size: f?.size });
        if (!v.ok) throw new NailShowcaseError('invalid', v.reason!);
        // Sep 2026 merge: the developer added video to this PUBLIC store and took the type from the browser's claim.
        // The BYTES decide now (constitution §160/§164): an image is sniffed; a video must carry an MP4/MOV 'ftyp' box or
        // the WebM/EBML header; the stored extension comes from what the bytes are, never from the claim or the filename.
        const ext = sniffShowcaseMedia(f?.buffer);
        if (!ext) throw new NailShowcaseError('invalid', 'That file is not a supported photo or video (JPG, PNG, WEBP, MP4, MOV, WEBM).');
        // Phase 12 (#34): the one upload policy — a customer's phone photo / video on the PUBLIC feed loses its EXIF / GPS
        // and location atoms; the key is server-chosen and random under the salon
        const up = await acceptUpload(UPLOAD_POLICIES.showcaseMedia, { bytes: f.buffer, filename: f?.originalname, declaredType: f?.mimetype, tenantId: ctx.tenantId || null, quotaReserved: true });
        const key = uploadObjectKey({ tenantId: ctx.tenantId || null, area: 'nail-showcase', owner: [ctx.branchId || null, ctx.userId, postId], ext: up.ext });
        const { url } = await this.storage.put(key, up.bytes);
        descriptors.push({ imageUrl: url, thumbnailUrl: url, caption: b?.caption ?? null });
      }
      return this.svc.addPhotosToPost(ctx, postId, descriptors);
    }
    return this.svc.addPhotosToPost(ctx, postId, b?.photos ?? []);
  }

  // Feed + posts
  @Get('nail-showcase/feed') feed(@Req() r: any, @Query() q: any) {
    const query: NSFeedQuery = { scope: q.scope, salonId: q.salonId, branchId: q.branchId, serviceId: q.serviceId, technicianId: q.technicianId, tag: q.tag, sort: q.sort, cursor: q.cursor, limit: q.limit ? Number(q.limit) : undefined };
    return run(() => this.svc.feed(ctxFrom(r), query));
  }
  @Get('nail-showcase/posts/:postId') getPost(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.getPost(ctxFrom(r), id)); }
  @Post('nail-showcase/posts') createPost(@Req() r: any, @Body(ValidatedBody(NS_POST_BODY)) b: any) { return run(() => this.svc.createManualPost(ctxFrom(r), b ?? {})); }
  @Patch('nail-showcase/posts/:postId') updatePost(@Req() r: any, @Param('postId') id: string, @Body(ValidatedBody(NS_POST_UPDATE_BODY)) b: any) { return run(() => this.svc.updatePost(ctxFrom(r), id, b ?? {})); }
  @Delete('nail-showcase/posts/:postId') deletePost(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.deletePost(ctxFrom(r), id)); }
  @Post('nail-showcase/posts/:postId/photos')
  @UseInterceptors(FilesInterceptor('files', NS_MAX_PHOTOS, { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.showcaseMedia.maxBytes + 1024 } }))
  addPhotos(@Req() r: any, @Param('postId') id: string, @UploadedFiles() files: any[], @Body(ValidatedBody(NS_PHOTOS_BODY)) b: any) { return run(() => this.ingestPhotos(ctxFrom(r), id, files ?? [], b)); }

  // Reactions
  @Post('nail-showcase/posts/:postId/reaction') react(@Req() r: any, @Param('postId') id: string, @Body(ValidatedBody(NS_REACTION_BODY)) b: any) { return run(() => this.svc.setReaction(ctxFrom(r), id, (b?.reactionType as NSReactionType) ?? 'like')); }
  @Delete('nail-showcase/posts/:postId/reaction') unreact(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.removeReaction(ctxFrom(r), id)); }

  // Comments
  @Get('nail-showcase/posts/:postId/comments') comments(@Req() r: any, @Param('postId') id: string) { return run(() => this.svc.listComments(ctxFrom(r), id)); }
  @Post('nail-showcase/posts/:postId/comments') addComment(@Req() r: any, @Param('postId') id: string, @Body(ValidatedBody(NS_COMMENT_BODY)) b: any) { return run(() => this.svc.addComment(ctxFrom(r), id, b?.commentText ?? b?.text ?? '')); }
  @Delete('nail-showcase/comments/:commentId') deleteComment(@Req() r: any, @Param('commentId') id: string) { return run(() => this.svc.deleteComment(ctxFrom(r), id)); }

  // Reports
  @Post('nail-showcase/posts/:postId/report') reportPost(@Req() r: any, @Param('postId') id: string, @Body(ValidatedBody(NS_REPORT_BODY)) b: any) { return run(() => this.svc.reportPost(ctxFrom(r), id, b?.reason ?? 'other', b?.details)); }
  @Post('nail-showcase/comments/:commentId/report') reportComment(@Req() r: any, @Param('commentId') id: string, @Body(ValidatedBody(NS_REPORT_BODY)) b: any) { return run(() => this.svc.reportComment(ctxFrom(r), id, b?.reason ?? 'other', b?.details)); }

  // Verified upload opportunity (linked to a completed ticket)
  @Get('tickets/:ticketId/nail-showcase-eligibility') eligibility(@Req() r: any, @Param('ticketId') id: string) { return run(() => this.svc.eligibility(ctxFrom(r), id)); }
  @Post('tickets/:ticketId/nail-showcase-post') verifiedPost(@Req() r: any, @Param('ticketId') id: string, @Body(ValidatedBody(NS_POST_BODY)) b: any) { return run(() => this.svc.createVerifiedPost(ctxFrom(r), id, b ?? {})); }
}

/** The stored extension for a showcase upload, decided by its bytes; null when it is none of the allowed kinds. */
export function sniffShowcaseMedia(buf: Buffer | undefined): string | null {
  if (!buf || buf.length < 12) return null;
  const img: any = validateImageUpload(buf, 'photo');
  if (img?.ok) return img.ext;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return buf.subarray(8, 12).toString('latin1').startsWith('qt') ? 'mov' : 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  return null;
}
