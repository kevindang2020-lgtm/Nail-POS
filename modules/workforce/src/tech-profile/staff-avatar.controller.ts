import { StaffSessionGuard } from '@aipowersalon/permissions/guards';
// staff-avatar.controller.ts — a signed-in user's own avatar (developer merge Sep 2026; migration 433 user_avatar_url).
// Lives in workforce (not identity): it uses the MEDIA_STORAGE port and image validation that the tech-profile owns,
// and identity must not depend on workforce. Routes stay at POST / DELETE /auth/avatar, as the apps call them.
import { Controller, Delete, HttpException, Inject, Optional, Post, Req, UploadedFile, UseInterceptors, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { makeMediaStorage, buildMediaUrl, acceptUpload, uploadObjectKey, UPLOAD_POLICIES, type MediaStorage } from '@aipowersalon/media';
import { MEDIA_STORAGE } from './tech-profile.service';
import { validateImageUpload } from './tech-profile-core';

@Controller('auth')
export class StaffAvatarController {
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase, @Optional() @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage | null) {}
  private uid(r: any): string { const u = r?.ctx?.userId; if (!u) throw new HttpException({ ok: false, code: 'UNAUTHENTICATED' }, 401); return u; }
  private need(): NonNullable<AppDatabase> { if (!this.db) throw new HttpException({ ok: false, code: 'UNAVAILABLE', message: 'Avatars need a database.' }, 503); return this.db; }
  private getStorage(): MediaStorage { return this.storage ?? makeMediaStorage(); }

  @UseGuards(StaffSessionGuard)   // own row only (Constitution 12 §27)
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.avatar.maxBytes, files: 1 } }))
  async uploadAvatar(@Req() r: any, @UploadedFile() file: any) {
    const db = this.need(); const userId = this.uid(r);
    if (!file?.buffer) throw new HttpException({ ok: false, code: 'NO_FILE', message: 'No image provided.' }, 400);
    const v = validateImageUpload(file.buffer, 'avatar');
    if (!v.ok) throw new HttpException({ ok: false, code: 'INVALID_IMAGE', message: v.message }, 400);
    // Phase 12 (#34): the one upload policy — bytes decide, metadata (EXIF GPS) stripped, a tenant-scoped random key
    // (was `avatar-<ms>.<ext>`: two users in the same millisecond overwrote each other's picture)
    const up = await acceptUpload(UPLOAD_POLICIES.avatar, { bytes: file.buffer, filename: file.originalname, declaredType: file.mimetype, tenantId: r?.ctx?.tenantId ?? null, quotaReserved: true });

    const oldUser = await db.selectFrom('users').select(['avatar_url']).where('id', '=', userId).executeTakeFirst();
    if (oldUser?.avatar_url) {
      await this.getStorage().remove(oldUser.avatar_url).catch(() => {});
    }

    const key = uploadObjectKey({ tenantId: r?.ctx?.tenantId ?? null, area: 'avatars', owner: ['staff', userId], ext: up.ext });
    await this.getStorage().put(key, up.bytes);
    await db.updateTable('users').set({ avatar_url: key, updated_at: new Date() }).where('id', '=', userId).execute();

    const fullUrl = buildMediaUrl(key);
    return { ok: true, avatarUrl: fullUrl };
  }

  @UseGuards(StaffSessionGuard)   // own row only (Constitution 12 §27)
  @Delete('avatar')
  async removeAvatar(@Req() r: any) {
    const db = this.need(); const userId = this.uid(r);
    const oldUser = await db.selectFrom('users').select(['avatar_url']).where('id', '=', userId).executeTakeFirst();
    if (oldUser?.avatar_url) {
      await this.getStorage().remove(oldUser.avatar_url).catch(() => {});
    }
    await db.updateTable('users').set({ avatar_url: null, updated_at: new Date() }).where('id', '=', userId).execute();
    return { ok: true, avatarUrl: null };
  }
}
