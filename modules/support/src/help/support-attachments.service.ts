// support-attachments.service.ts — Support Center ticket attachments over the ESTABLISHED MediaStorage port.
// Reuses tech-profile's storage abstraction (same interface, same local-disk driver) with a SEPARATE PRIVATE root:
// the public /media/* controller resolves only inside its own root, so attachment keys are unreachable publicly and
// every byte flows through these authorized endpoints. Authorization mirrors the ticket rules exactly — a requester
// sees attachments only on tickets they could open via getTicket (own tickets, or all tenant tickets for triagers).
import { Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { DB } from '@aipowersalon/database';
import { DATABASE } from '@aipowersalon/database';
import type { MediaStorage, StorageQuotaPort } from '@aipowersalon/media';
import { acceptUpload, UploadRejected, UPLOAD_POLICIES, STORAGE_QUOTA } from '@aipowersalon/media';
import {
  ATTACHMENT_MAX_PER_TICKET, attachmentStorageKey, canDeleteAttachment, validateAttachmentUpload,
  type AttachmentUploadInput,
} from './support-attachments-core';
import { canSeeAllTenantTickets, canTriageTickets } from './support-tickets.service';
import type { HelpCtx } from './help.service';

export const SUPPORT_ATTACHMENT_STORAGE = Symbol('SUPPORT_ATTACHMENT_STORAGE');

export interface AttachmentRow {
  id: string; ticketId: string; fileName: string; contentType: string; sizeBytes: number;
  uploadedByUserId: string | null; createdAt: string;
}

@Injectable()
export class SupportAttachmentsService {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: Kysely<DB> | null,
    @Optional() @Inject(SUPPORT_ATTACHMENT_STORAGE) private readonly storage: MediaStorage | null,
    @Optional() @Inject(STORAGE_QUOTA) private readonly quota: StorageQuotaPort | null = null,
  ) {}

  private async query<T>(text: ReturnType<typeof sql>): Promise<T[]> {
    if (!this.db) return [];
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; } catch { return []; }
  }

  /** The same visibility rule getTicket applies: tenant match + (own ticket unless a triager role). */
  private async accessibleTicket(ctx: HelpCtx, ticketId: string): Promise<{ id: string; status: string } | null> {
    if (!ctx.tenantId) return null;
    const rows = await this.query<any>(sql`
      SELECT id, status, created_by_user_id FROM support_tickets
      WHERE tenant_id = ${ctx.tenantId} AND id = ${ticketId} LIMIT 1`);
    const t = rows[0];
    if (!t) return null;
    if (!canSeeAllTenantTickets(ctx) && t.created_by_user_id !== ctx.userId) return null;
    return { id: t.id, status: String(t.status ?? '') };
  }

  async list(ctx: HelpCtx, ticketId: string): Promise<{ ok: boolean; error?: string; attachments?: AttachmentRow[] }> {
    const t = await this.accessibleTicket(ctx, ticketId);
    if (!t) return { ok: false, error: 'not_found' };
    const rows = await this.query<any>(sql`
      SELECT id, ticket_id, file_name, content_type, size_bytes, uploader_user_id, created_at
      FROM support_ticket_attachments WHERE ticket_id = ${ticketId} AND deleted_at IS NULL ORDER BY created_at ASC`);
    return {
      ok: true,
      attachments: rows.map((r) => ({
        id: r.id, ticketId: r.ticket_id, fileName: r.file_name, contentType: r.content_type,
        sizeBytes: Number(r.size_bytes), uploadedByUserId: r.uploader_user_id ?? null, createdAt: String(r.created_at),
      })),
    };
  }

  async upload(ctx: HelpCtx, ticketId: string, input: AttachmentUploadInput): Promise<{ ok: boolean; error?: string; attachment?: AttachmentRow }> {
    if (!ctx.userId || !ctx.tenantId) return { ok: false, error: 'unauthenticated' };
    if (!this.db || !this.storage) return { ok: false, error: 'Attachments are unavailable — storage is not configured.' };
    const t = await this.accessibleTicket(ctx, ticketId);
    if (!t) return { ok: false, error: 'not_found' };
    if (/^(closed|cancelled)$/i.test(t.status)) return { ok: false, error: 'This ticket is closed — attachments can no longer be added.' };
    const v = validateAttachmentUpload(input);
    if (!v.ok) return { ok: false, error: v.error };
    const count = await this.query<any>(sql`
      SELECT count(*)::int AS n FROM support_ticket_attachments WHERE ticket_id = ${ticketId} AND deleted_at IS NULL`);
    if (Number(count[0]?.n ?? 0) >= ATTACHMENT_MAX_PER_TICKET) return { ok: false, error: `A ticket can hold at most ${ATTACHMENT_MAX_PER_TICKET} attachments.` };

    // Phase 12 (#34): the declared type no longer decides — the BYTES must be what it says (an HTML page declared
    // image/png was stored and served back as one); images lose their EXIF; the salon's storage quota is charged
    let up;
    try { up = await acceptUpload(UPLOAD_POLICIES.supportAttachment, { bytes: v.value.bytes, filename: v.value.fileName, declaredType: v.value.contentType, tenantId: ctx.tenantId }, { quota: this.quota }); }
    catch (e) { if (e instanceof UploadRejected) return { ok: false, error: e.message }; throw e; }
    if (up.contentType !== v.value.contentType && !(up.kind === 'text' && /^text\//.test(v.value.contentType))) {
      if (up.quotaReservedBytes) await this.quota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined);
      return { ok: false, error: 'The file type does not match the file contents.' };
    }
    const opaque = randomUUID();
    const key = attachmentStorageKey(ctx.tenantId, ticketId, opaque, v.value.ext);
    try { await this.storage.put(key, up.bytes); }
    catch (e) { if (up.quotaReservedBytes) await this.quota?.releaseStorage(ctx.tenantId, up.quotaReservedBytes).catch(() => undefined); throw e; }
    const inserted = await this.query<any>(sql`
      INSERT INTO support_ticket_attachments (tenant_id, ticket_id, uploader_user_id, storage_key, file_name, content_type, size_bytes)
      VALUES (${ctx.tenantId}, ${ticketId}, ${ctx.userId}, ${key}, ${v.value.fileName}, ${v.value.contentType}, ${up.size})
      RETURNING id, created_at`);
    const row = inserted[0];
    if (!row) { await this.storage.remove(key); return { ok: false, error: 'Could not save the attachment.' }; }
    await this.query(sql`
      INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
      VALUES (${ticketId}, ${ctx.tenantId}, 'attachment_added', ${v.value.fileName + ' (' + up.size + ' bytes)'}, ${ctx.userId})`);
    return {
      ok: true,
      attachment: {
        id: row.id, ticketId, fileName: v.value.fileName, contentType: v.value.contentType,
        sizeBytes: up.size, uploadedByUserId: ctx.userId, createdAt: String(row.created_at),
      },
    };
  }

  /** Streams back as base64 JSON (the repo's export convention); storage_key never leaves the server. */
  async download(ctx: HelpCtx, ticketId: string, attachmentId: string): Promise<{ ok: boolean; error?: string; fileName?: string; contentType?: string; data?: string }> {
    if (!this.storage) return { ok: false, error: 'Attachments are unavailable — storage is not configured.' };
    const t = await this.accessibleTicket(ctx, ticketId);
    if (!t) return { ok: false, error: 'not_found' };
    const rows = await this.query<any>(sql`
      SELECT storage_key, file_name, content_type FROM support_ticket_attachments
      WHERE id = ${attachmentId} AND ticket_id = ${ticketId} AND deleted_at IS NULL LIMIT 1`);
    const a = rows[0];
    if (!a) return { ok: false, error: 'not_found' };
    const abs = this.storage.resolvePath(a.storage_key);
    if (!abs) return { ok: false, error: 'not_found' };
    try {
      const bytes = await fs.readFile(abs);
      return { ok: true, fileName: a.file_name, contentType: a.content_type, data: bytes.toString('base64') };
    } catch { return { ok: false, error: 'The stored file could not be read.' }; }
  }

  async remove(ctx: HelpCtx, ticketId: string, attachmentId: string): Promise<{ ok: boolean; error?: string }> {
    if (!ctx.userId) return { ok: false, error: 'unauthenticated' };
    if (!this.storage) return { ok: false, error: 'Attachments are unavailable — storage is not configured.' };
    const t = await this.accessibleTicket(ctx, ticketId);
    if (!t) return { ok: false, error: 'not_found' };
    const rows = await this.query<any>(sql`
      SELECT storage_key, uploader_user_id FROM support_ticket_attachments
      WHERE id = ${attachmentId} AND ticket_id = ${ticketId} AND deleted_at IS NULL LIMIT 1`);
    const a = rows[0];
    if (!a) return { ok: false, error: 'not_found' };
    if (!canDeleteAttachment({ uploaderUserId: a.uploader_user_id ?? null, userId: ctx.userId, isTriager: canTriageTickets(ctx), ticketStatus: t.status })) {
      return { ok: false, error: 'Only the uploader (while the ticket is open) or a manager can remove an attachment.' };
    }
    await this.query(sql`
      UPDATE support_ticket_attachments SET deleted_at = now(), deleted_by_user_id = ${ctx.userId}
      WHERE id = ${attachmentId} AND ticket_id = ${ticketId} AND deleted_at IS NULL`);
    await this.storage.remove(a.storage_key);
    await this.query(sql`
      INSERT INTO support_ticket_events (ticket_id, tenant_id, kind, detail, actor_user_id)
      VALUES (${ticketId}, ${ctx.tenantId}, 'attachment_removed', ${String(attachmentId)}, ${ctx.userId})`);
    return { ok: true };
  }
}
