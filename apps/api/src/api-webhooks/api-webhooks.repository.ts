// api-webhooks.repository.ts — port + in-memory adapter (dev/offline/test default). The store keeps ONLY hashes
// (secretHash for keys, encrypted signingSecretEnc for webhooks); raw secrets never live here. Seeded for tenant 'luxe001' only (isolation).
import type { ApiWebhooksContext } from './api-webhooks.dto';

export interface StoredKey {
  id: string; name: string; prefix: string; secretHash: string; environment: string; scopes: string[];
  createdByUserId: string | null; lastUsedMs: number | null; expiresMs: number | null; revokedMs: number | null; createdMs: number;
}
export interface StoredWebhook {
  id: string; name: string; url: string; events: string[]; signingSecretEnc: string; status: string;
  createdByUserId: string | null; lastDeliveryMs: number | null; lastSuccessMs: number | null; lastFailureMs: number | null; failureCount: number; createdMs: number;
}

export interface NewKey { name: string; prefix: string; secretHash: string; environment: string; scopes: string[]; createdByUserId: string | null; expiresMs: number | null }
export interface NewWebhook { name: string; url: string; events: string[]; signingSecretEnc: string; createdByUserId: string | null }

export interface ApiWebhooksRepositoryPort {
  listKeys(ctx: ApiWebhooksContext): Promise<StoredKey[]>;
  insertKey(ctx: ApiWebhooksContext, k: NewKey): Promise<StoredKey>;
  getKey(ctx: ApiWebhooksContext, id: string): Promise<StoredKey | null>;
  rotateKey(ctx: ApiWebhooksContext, id: string, secretHash: string, prefix: string): Promise<StoredKey | null>;
  revokeKey(ctx: ApiWebhooksContext, id: string): Promise<boolean>;
  listWebhooks(ctx: ApiWebhooksContext): Promise<StoredWebhook[]>;
  insertWebhook(ctx: ApiWebhooksContext, w: NewWebhook): Promise<StoredWebhook>;
  getWebhook(ctx: ApiWebhooksContext, id: string): Promise<StoredWebhook | null>;
  setWebhookStatus(ctx: ApiWebhooksContext, id: string, status: string): Promise<boolean>;
  rotateWebhookSecret(ctx: ApiWebhooksContext, id: string, signingSecretEnc: string): Promise<boolean>;
  recordDelivery(ctx: ApiWebhooksContext, id: string, ok: boolean): Promise<void>;
}

const SEED = 'luxe001';
let seq = 1;
const nid = (p: string) => `${p}_${seq++}`;

export class InMemoryApiWebhooksRepository implements ApiWebhooksRepositoryPort {
  private keys = new Map<string, StoredKey[]>();
  private hooks = new Map<string, StoredWebhook[]>();

  private kArr(ctx: ApiWebhooksContext): StoredKey[] {
    if (!this.keys.has(ctx.tenantId)) {
      const now = Date.now();
      this.keys.set(ctx.tenantId, ctx.tenantId === SEED ? [
        { id: 'key_seed_1', name: 'Production API Key', prefix: 'ak_live_Q7x2', secretHash: 'seed-hash-not-a-real-secret', environment: 'live', scopes: ['services.read', 'appointments.read'], createdByUserId: null, lastUsedMs: now - 3_600_000, expiresMs: null, revokedMs: null, createdMs: now - 30 * 86_400_000 },
      ] : []);
    }
    return this.keys.get(ctx.tenantId)!;
  }
  private hArr(ctx: ApiWebhooksContext): StoredWebhook[] {
    if (!this.hooks.has(ctx.tenantId)) {
      const now = Date.now();
      this.hooks.set(ctx.tenantId, ctx.tenantId === SEED ? [
        { id: 'wh_seed_1', name: 'Appointments → CRM', url: 'https://hooks.example.com/crm', events: ['appointment.created', 'appointment.cancelled'], signingSecretEnc: 'iv.tag.ct-dev-seed-not-real', status: 'active', createdByUserId: null, lastDeliveryMs: now - 600_000, lastSuccessMs: now - 600_000, lastFailureMs: null, failureCount: 0, createdMs: now - 14 * 86_400_000 },
      ] : []);
    }
    return this.hooks.get(ctx.tenantId)!;
  }

  async listKeys(ctx: ApiWebhooksContext) { return this.kArr(ctx).filter((k) => k.revokedMs == null).map((k) => ({ ...k })); }
  async insertKey(ctx: ApiWebhooksContext, k: NewKey) {
    const row: StoredKey = { id: nid('key'), ...k, lastUsedMs: null, revokedMs: null, createdMs: Date.now() };
    this.kArr(ctx).push(row); return { ...row };
  }
  async getKey(ctx: ApiWebhooksContext, id: string) { return this.kArr(ctx).find((k) => k.id === id) ? { ...this.kArr(ctx).find((k) => k.id === id)! } : null; }
  async rotateKey(ctx: ApiWebhooksContext, id: string, secretHash: string, prefix: string) {
    const k = this.kArr(ctx).find((x) => x.id === id && x.revokedMs == null); if (!k) return null;
    k.secretHash = secretHash; k.prefix = prefix; return { ...k };
  }
  async revokeKey(ctx: ApiWebhooksContext, id: string) {
    const k = this.kArr(ctx).find((x) => x.id === id && x.revokedMs == null); if (!k) return false; k.revokedMs = Date.now(); return true;
  }

  async listWebhooks(ctx: ApiWebhooksContext) { return this.hArr(ctx).map((w) => ({ ...w })); }
  async insertWebhook(ctx: ApiWebhooksContext, w: NewWebhook) {
    const row: StoredWebhook = { id: nid('wh'), ...w, status: 'active', lastDeliveryMs: null, lastSuccessMs: null, lastFailureMs: null, failureCount: 0, createdMs: Date.now() };
    this.hArr(ctx).push(row); return { ...row };
  }
  async getWebhook(ctx: ApiWebhooksContext, id: string) { const w = this.hArr(ctx).find((x) => x.id === id); return w ? { ...w } : null; }
  async setWebhookStatus(ctx: ApiWebhooksContext, id: string, status: string) { const w = this.hArr(ctx).find((x) => x.id === id); if (!w) return false; w.status = status; return true; }
  async rotateWebhookSecret(ctx: ApiWebhooksContext, id: string, signingSecretEnc: string) { const w = this.hArr(ctx).find((x) => x.id === id); if (!w) return false; w.signingSecretEnc = signingSecretEnc; return true; }
  async recordDelivery(ctx: ApiWebhooksContext, id: string, ok: boolean) { const w = this.hArr(ctx).find((x) => x.id === id); if (!w) return; const now = Date.now(); w.lastDeliveryMs = now; if (ok) { w.lastSuccessMs = now; } else { w.lastFailureMs = now; w.failureCount += 1; } }
}
