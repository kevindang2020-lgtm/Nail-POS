/**
 * media.controller.ts — read-only serving for stored media (/media/*). Path-traversal is refused inside the storage
 * adapter; unknown keys 404. Excluded from tenant middleware so the customer app can load images anonymously.
 *
 * ACCESS CONTROL (Technician Profile merge, Oct 12 2026 — mandate §93, §117–§118): this used to stream EVERY key. Now:
 *   • public objects (approved + published portfolio / before-after, published showcase photos, avatars of visible
 *     profiles, keys no private table references) are served openly, cacheable;
 *   • everything else (private / hidden / rejected / pending photos, unpublished sets, SKILL DOCUMENTS, media of a
 *     hidden or suspended profile) needs EITHER a valid short-lived signed URL (`?exp=&sig=`, HMAC over key+exp — the
 *     APIs that list private media hand these out) OR a verified session that the DB confirms is the owning
 *     technician, a manager of a salon where the tech is active, or a super admin. Refusals are 404, never 403,
 *     so the existence of a private object is not an oracle.
 */
import { Controller, Get, Inject, NotFoundException, Optional, Req, Res } from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import type { MediaStorage } from '@aipowersalon/media';
import { sessionFromRequest } from '@aipowersalon/identity';
import { MEDIA_STORAGE } from './tech-profile.service';
import { MediaAccessService } from './media-access.service';
import { isPubliclyServable, MEDIA_CONTENT_TYPES, verifyMediaSignature, viewerMayRead } from './media-access-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@Controller()
export class MediaController {
  constructor(
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null,
    @Optional() @Inject(MediaAccessService) private readonly access: MediaAccessService | null,
  ) {}

  /** Pure decision for one request — exported for the pgtest. Returns the cache policy, or null = refuse. */
  async decide(key: string, query: Record<string, any>, headers: Record<string, any>): Promise<'public' | 'private' | null> {
    // No DB → the service answers from the key namespace alone: 'other' stays public, every private class fails closed.
    const access = this.access ?? new MediaAccessService(null);
    const facts = await access.facts(key);
    if (isPubliclyServable(facts)) return 'public';
    if (verifyMediaSignature(key, query?.exp, query?.sig, { signKey: access.signKey() })) return 'private';
    // /media/* is outside every realm's path: try the tenant realm cookie (staff, technicians), then the platform one
    // (a super admin reviewing a document). The customer realm never reads private media.
    const secret = process.env.AUTH_SESSION_SECRET || '';
    const session = sessionFromRequest({ headers, path: '/media' }, secret) ?? sessionFromRequest({ headers, path: '/super-admin/media' }, secret);
    if (session && viewerMayRead(facts, await access.viewer(session as any, facts))) return 'private';
    return null;
  }

  @Get('media/*')
  async serve(@Req() req: any, @Res() res: any) {
    const key = String(req.params?.[0] ?? req.params?.path ?? '').replace(/^\/+/, '');
    const abs = this.storage?.resolvePath(key) ?? null;
    if (!abs || !existsSync(abs)) throw withCode(new NotFoundException('Not found.'), 'RESOURCE_NOT_FOUND');
    const policy = await this.decide(key, req.query ?? {}, req.headers ?? {});
    if (!policy) throw withCode(new NotFoundException('Not found.'), 'RESOURCE_NOT_FOUND');
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    res.setHeader('Content-Type', MEDIA_CONTENT_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', policy === 'public' ? 'public, max-age=86400' : 'private, no-store');
    createReadStream(abs).pipe(res);
  }
}
