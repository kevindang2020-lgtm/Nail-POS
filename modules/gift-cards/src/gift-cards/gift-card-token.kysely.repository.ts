// gift-card-token.kysely.repository.ts — Postgres adapter for presentation tokens.
import { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { GiftCardTokenRepositoryPort, GiftCardTokenRow, TokenContext } from './gift-card-token.service';

const iso = (v: any): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class KyselyGiftCardTokenRepository implements GiftCardTokenRepositoryPort {
  constructor(private db: Kysely<DB>) {}

  async insertToken(ctx: TokenContext, t: { giftCardId: string; tokenHash: string; nonce: string; expiresAt: Date }): Promise<void> {
    await this.db.insertInto('gift_card_presentation_tokens')
      .values({ tenant_id: ctx.tenantId, gift_card_id: t.giftCardId, token_hash: t.tokenHash, nonce: t.nonce, expires_at: t.expiresAt } as any)
      .execute();
  }

  async findByHash(ctx: TokenContext, tokenHash: string): Promise<GiftCardTokenRow | null> {
    const r = await this.db.selectFrom('gift_card_presentation_tokens')
      .select(['id', 'gift_card_id', 'expires_at', 'used_at', 'revoked_at'])
      .where('tenant_id', '=', ctx.tenantId).where('token_hash', '=', tokenHash)
      .executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return { id: (r as any).id, giftCardId: (r as any).gift_card_id, expiresAt: iso((r as any).expires_at), usedAt: (r as any).used_at ? iso((r as any).used_at) : null, revokedAt: (r as any).revoked_at ? iso((r as any).revoked_at) : null };
  }

  async markUsed(ctx: TokenContext, tokenId: string): Promise<boolean> {
    const u = await this.db.updateTable('gift_card_presentation_tokens')
      .set({ used_at: new Date() } as any)
      .where('id', '=', tokenId).where('tenant_id', '=', ctx.tenantId).where('used_at', 'is', null)
      .executeTakeFirst();
    return Number((u as any)?.numUpdatedRows ?? 0) > 0;
  }
}
