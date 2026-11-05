// Kysely + stub implementations for the customer-facing photo-consent port. Every read/write is keyed on the
// customer's resolved customers.id, so a customer can only ever reach their own consent rows.
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { NailShowcaseContext } from './nail-showcase.repository';
import type { NailPhotoConsentPort, MyConsentedPhoto } from './nail-photo-consent.service';

function parseUses(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') { try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

export class KyselyNailPhotoConsentRepository implements NailPhotoConsentPort {
  constructor(private readonly db: Kysely<DB>) {}

  async resolveCustomerRecordId(ctx: NailShowcaseContext): Promise<string | null> {
    const r: any = await this.db.selectFrom('customers').select('id').where('user_id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst().catch(() => null);
    return r?.id ?? null;
  }

  async listConsentedPhotos(ctx: NailShowcaseContext, customerRecordId: string): Promise<MyConsentedPhoto[]> {
    const rows: any[] = await (this.db as any).selectFrom('nail_photo_consent as nc')
      .innerJoin('tech_portfolio_photos as p', 'p.id', 'nc.photo_id')
      .where('nc.customer_id', '=', customerRecordId)
      .where('nc.tenant_id', '=', ctx.tenantId)
      .where('nc.revoked', '=', false)
      .select(['nc.photo_id as photo_id', 'p.image_url as image_url', 'p.thumbnail_url as thumbnail_url', 'p.caption as caption', 'nc.approved_uses as approved_uses', 'nc.public_blocked as public_blocked', 'nc.created_at as created_at'])
      .orderBy('nc.created_at', 'desc').execute().catch(() => []);
    return rows.map((r) => ({
      photoId: r.photo_id,
      imageUrl: r.image_url,
      thumbnailUrl: r.thumbnail_url ?? null,
      caption: r.caption ?? null,
      approvedUses: parseUses(r.approved_uses),
      publicBlocked: !!r.public_blocked,
      consentedAt: r.created_at == null ? '' : new Date(r.created_at).toISOString(),
    }));
  }

  async activeConsentExists(photoId: string, customerRecordId: string, tenantId: string | null): Promise<boolean> {
    let q: any = (this.db as any).selectFrom('nail_photo_consent').select('id').where('photo_id', '=', photoId).where('customer_id', '=', customerRecordId).where('revoked', '=', false);
    if (tenantId) q = q.where('tenant_id', '=', tenantId);
    const r: any = await q.executeTakeFirst().catch(() => null);
    return !!r;
  }

  async withdrawConsent(photoId: string, customerRecordId: string): Promise<void> {
    await (this.db as any).updateTable('nail_photo_consent')
      .set({ revoked: true, revoked_at: new Date(), public_blocked: true, updated_at: new Date() })
      .where('photo_id', '=', photoId).where('customer_id', '=', customerRecordId).execute();
  }

  async writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    await (this.db as any).insertInto('audit_logs').values({
      tenant_id: input.tenantId, branch_id: input.branchId, user_id: input.userId, role: input.role,
      action_type: input.actionType, entity_type: input.entityType, entity_id: input.entityId,
      metadata_json: input.metadata != null ? JSON.stringify(input.metadata) : null,
    }).execute().catch(() => { /* audit is best-effort, never blocks the withdrawal */ });
  }
}

export class StubNailPhotoConsentRepository implements NailPhotoConsentPort {
  async resolveCustomerRecordId(): Promise<string | null> { return null; }
  async listConsentedPhotos(): Promise<MyConsentedPhoto[]> { return []; }
  async activeConsentExists(): Promise<boolean> { return false; }
  async withdrawConsent(): Promise<void> { /* no-op */ }
  async writeAudit(): Promise<void> { /* no-op */ }
}
