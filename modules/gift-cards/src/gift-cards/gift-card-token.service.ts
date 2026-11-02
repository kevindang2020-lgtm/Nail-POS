// gift-card-token.service.ts — mint + validate gift-card presentation tokens on top of the pure core.
// The service owns the token lifecycle only; resolving the card summary (masked reference, balance) is the caller's job
// (it reuses the existing gift-card balance read), which keeps this focused and the in-memory adapter card-data-free.
import { mintTokenMaterial, tokenHashFromPayload, tokenValidity, clampTtlSeconds } from './gift-card-token-core';

export interface TokenContext { tenantId: string; }

export interface GiftCardTokenRow { id: string; giftCardId: string; expiresAt: string; usedAt: string | null; revokedAt: string | null; }

export interface GiftCardTokenRepositoryPort {
  insertToken(ctx: TokenContext, t: { giftCardId: string; tokenHash: string; nonce: string; expiresAt: Date }): Promise<void>;
  findByHash(ctx: TokenContext, tokenHash: string): Promise<GiftCardTokenRow | null>;
  /** Conditional (used_at IS NULL) — returns true only for the caller that actually claimed the single use. */
  markUsed(ctx: TokenContext, tokenId: string): Promise<boolean>;
}

export type ValidateResult = { ok: true; giftCardId: string } | { ok: false; reason: 'malformed' | 'not_found' | 'revoked' | 'used' | 'expired' };

export class GiftCardTokenService {
  constructor(private repo: GiftCardTokenRepositoryPort, private now: () => number = () => Date.now()) {}

  // Mint a presentation token for a card the CALLER has already authorized (owns / active). Returns the opaque payload
  // for the QR and its expiry. TTL is clamped to a safe window regardless of the configured value.
  async mint(ctx: TokenContext, giftCardId: string, ttlSeconds?: number): Promise<{ payload: string; expiresAt: string }> {
    const m = mintTokenMaterial();
    const expiresAt = new Date(this.now() + clampTtlSeconds(ttlSeconds) * 1000);
    await this.repo.insertToken(ctx, { giftCardId, tokenHash: m.tokenHash, nonce: m.nonce, expiresAt });
    return { payload: m.payload, expiresAt: expiresAt.toISOString() };
  }

  // Validate a scanned payload and, on success, atomically consume it (single-use). Returns the card id for the caller
  // to resolve and redeem — never a balance or the raw code.
  async validate(ctx: TokenContext, payload: string): Promise<ValidateResult> {
    const hash = tokenHashFromPayload(payload);
    if (!hash) return { ok: false, reason: 'malformed' };
    const row = await this.repo.findByHash(ctx, hash);
    const v = tokenValidity(row, this.now());
    if (!v.ok) return { ok: false, reason: v.reason! };
    const claimed = await this.repo.markUsed(ctx, row!.id);
    if (!claimed) return { ok: false, reason: 'used' }; // lost a concurrent race for the single use
    return { ok: true, giftCardId: row!.giftCardId };
  }
}

// In-memory adapter — tracks tokens only (no card data). Honest: a DB-less deployment can still exercise the lifecycle.
export class InMemoryGiftCardTokenRepository implements GiftCardTokenRepositoryPort {
  private rows = new Map<string, { id: string; tenantId: string; giftCardId: string; nonce: string; expiresAt: string; usedAt: string | null; revokedAt: string | null }>();
  private seq = 0;
  async insertToken(ctx: TokenContext, t: { giftCardId: string; tokenHash: string; nonce: string; expiresAt: Date }): Promise<void> {
    this.rows.set(t.tokenHash, { id: 'tok_' + (++this.seq), tenantId: ctx.tenantId, giftCardId: t.giftCardId, nonce: t.nonce, expiresAt: t.expiresAt.toISOString(), usedAt: null, revokedAt: null });
  }
  async findByHash(ctx: TokenContext, tokenHash: string): Promise<GiftCardTokenRow | null> {
    const r = this.rows.get(tokenHash);
    if (!r || r.tenantId !== ctx.tenantId) return null;
    return { id: r.id, giftCardId: r.giftCardId, expiresAt: r.expiresAt, usedAt: r.usedAt, revokedAt: r.revokedAt };
  }
  async markUsed(ctx: TokenContext, tokenId: string): Promise<boolean> {
    for (const r of this.rows.values()) {
      if (r.id === tokenId && r.tenantId === ctx.tenantId) { if (r.usedAt) return false; r.usedAt = new Date().toISOString(); return true; }
    }
    return false;
  }
  /** test hook: force-expire or revoke a token by its hash */
  _mutate(tokenHash: string, patch: Partial<{ expiresAt: string; revokedAt: string | null }>): void {
    const r = this.rows.get(tokenHash); if (r) Object.assign(r, patch);
  }
}
