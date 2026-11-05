// voice-key.service.ts — voice integration-key use-cases (Phase 2). Issue/rotate/revoke keys and, on the hot path,
// resolve a presented key to a VoiceContext (tenant+branch). The raw key is shown ONCE at creation and never stored.
import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { composeVoiceKey, hashVoiceKey, isUsableVoiceKey } from './voice-key-core';
import type { VoiceContext } from './voice-booking.service';

export interface VoiceKeyRow {
  id: string; tenantId: string; branchId: string; label: string; provider: string; prefix: string;
  secretHash: string; lastUsedMs: number | null; expiresMs: number | null; revokedMs: number | null; createdMs: number;
}

/** Persistence port — a kysely impl backs prod; the in-memory impl below backs dev/tests. */
export interface VoiceKeyRepo {
  insert(row: Omit<VoiceKeyRow, 'lastUsedMs' | 'revokedMs' | 'createdMs'> & { createdByUserId?: string | null }): Promise<VoiceKeyRow>;
  findActiveByHash(secretHash: string): Promise<VoiceKeyRow | null>;
  touchLastUsed(id: string, whenMs: number): Promise<void>;
  revoke(tenantId: string, id: string, whenMs: number): Promise<boolean>;
  listForTenant(tenantId: string): Promise<VoiceKeyRow[]>;
}

export class VoiceKeyForbiddenError extends Error {}

@Injectable()
export class VoiceKeyService {
  constructor(@Inject('VoiceKeyRepo') private readonly repo: VoiceKeyRepo) {}

  /** Issue a new key. Returns the RAW key exactly once (caller must copy it — it is never retrievable again). */
  async issue(input: { tenantId: string; branchId: string; label: string; provider?: string; environment?: 'live' | 'test'; expiresMs?: number | null; createdByUserId?: string | null }): Promise<{ raw: string; row: VoiceKeyRow }> {
    const token = randomBytes(24).toString('base64url');
    const { raw, prefix } = composeVoiceKey(input.environment ?? 'live', token);
    const row = await this.repo.insert({
      id: cryptoId(), tenantId: input.tenantId, branchId: input.branchId, label: input.label,
      provider: input.provider ?? 'retell', prefix, secretHash: hashVoiceKey(raw),
      expiresMs: input.expiresMs ?? null, createdByUserId: input.createdByUserId ?? null,
    });
    return { raw, row };
  }

  /**
   * HOT PATH: resolve a presented raw key to a VoiceContext, or null if it's unknown/expired/revoked. tenant+branch
   * come from the STORED row — never from the caller — which is the whole security point. Updates last_used best-effort.
   */
  async resolveContext(presentedRaw: string | null | undefined, nowMs = Date.now()): Promise<(VoiceContext & { keyId: string; provider: string }) | null> {
    if (!presentedRaw || typeof presentedRaw !== 'string') return null;
    const row = await this.repo.findActiveByHash(hashVoiceKey(presentedRaw.trim()));
    if (!isUsableVoiceKey(row, nowMs)) return null;
    // best-effort last-used; never blocks or fails the request
    try { await this.repo.touchLastUsed(row!.id, nowMs); } catch { /* ignore */ }
    return { tenantId: row!.tenantId, branchId: row!.branchId, keyId: row!.id, provider: row!.provider };
  }

  async revoke(tenantId: string, id: string, nowMs = Date.now()): Promise<boolean> { return this.repo.revoke(tenantId, id, nowMs); }
  async list(tenantId: string): Promise<VoiceKeyRow[]> { return this.repo.listForTenant(tenantId); }
}

function cryptoId(): string { return randomBytes(16).toString('hex'); }

/** In-memory repo for dev/tests. Not used in prod (the kysely repo is). */
export class InMemoryVoiceKeyRepo implements VoiceKeyRepo {
  private rows: VoiceKeyRow[] = [];
  async insert(r: any): Promise<VoiceKeyRow> {
    const row: VoiceKeyRow = { ...r, lastUsedMs: null, revokedMs: null, createdMs: Date.now() };
    this.rows.push(row); return row;
  }
  async findActiveByHash(secretHash: string): Promise<VoiceKeyRow | null> {
    return this.rows.find((r) => r.secretHash === secretHash && r.revokedMs == null) ?? null;
  }
  async touchLastUsed(id: string, whenMs: number): Promise<void> { const r = this.rows.find((x) => x.id === id); if (r) r.lastUsedMs = whenMs; }
  async revoke(tenantId: string, id: string, whenMs: number): Promise<boolean> {
    const r = this.rows.find((x) => x.id === id && x.tenantId === tenantId && x.revokedMs == null);
    if (!r) return false; r.revokedMs = whenMs; return true;
  }
  async listForTenant(tenantId: string): Promise<VoiceKeyRow[]> { return this.rows.filter((r) => r.tenantId === tenantId); }
}
