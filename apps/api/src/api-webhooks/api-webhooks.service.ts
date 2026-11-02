// api-webhooks.service.ts — tenant API-key + webhook use-cases. Secrets are generated with node crypto, hashed with
// SHA-256, and the raw value is returned to the caller exactly ONCE (create/rotate) and never stored or logged.
// Secret-minting actions (create key, rotate key, create webhook, rotate signing secret) require the OWNER role;
// status changes (revoke key, pause/resume/disable webhook) require the manage capability (settings.edit). Webhook
// URLs are SSRF-validated before they are ever stored. Every mutation writes an audit record (without secrets).
import { safeOutboundRequest } from '@aipowersalon/security';
import { integrationPermissions } from '../common/api-key-auth';
import { randomBytes, createHash } from 'crypto';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { keyStatus, maskedKey, composeKey, isSafeWebhookUrl, isSafeWebhookUrlResolved, normalizeScopes, normalizeEvents } from './api-webhooks-core';
import { encryptSecret, decryptSecret } from '../common/webhook-crypto';
import { sign, signatureHeader, buildEnvelope } from './webhook-delivery-core';
import type { LogSink } from '../logs/logs.dto';
import type {
  ApiWebhooksContext, ApiKeyView, ApiKeyCreated, WebhookView, WebhookCreated, WebhookTestResult, CreateApiKeyRequest, CreateWebhookRequest,
} from './api-webhooks.dto';
import type { ApiWebhooksRepositoryPort, StoredKey, StoredWebhook } from './api-webhooks.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class NotFoundError extends Error { constructor(msg = 'Not found') { super(msg); this.name = 'NotFoundError'; } }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const randToken = () => randomBytes(18).toString('base64url');
const randSigningSecret = () => 'whsec_' + randomBytes(24).toString('base64url');
const iso = (ms: number | null): string | null => (ms == null ? null : new Date(ms).toISOString());

// Injectable outbound sender — the service signs and hands the request here. The default uses fetch with an SSRF
// re-check and a hard timeout; tests inject a fake so no real network call is made.
export interface WebhookSendRequest { url: string; headers: Record<string, string>; body: string }
export interface WebhookSendResult { ok: boolean; status: number | null; error?: string }
export type WebhookSender = (req: WebhookSendRequest) => Promise<WebhookSendResult>;

export const defaultSender: WebhookSender = async ({ url, headers, body }) => {
  // Security Deep Scan D1: the shared SSRF-safe client — the connection's own DNS answer is checked (no rebinding), a
  // redirect is never followed (a public URL answering 307 used to deliver this signed POST to 127.0.0.1 / *.internal),
  // https only, 5 s cap. The resolution pre-check stays for a clear "Unsafe URL" before any socket opens.
  const safe = await isSafeWebhookUrlResolved(url);
  if (!safe.ok) return { ok: false, status: null, error: 'Unsafe URL' };
  const r = await safeOutboundRequest(url, { method: 'POST', headers, body, timeoutMs: 5000, maxBytes: 8 * 1024 });
  return { ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : r.status != null && r.status >= 300 && r.status < 400 ? { error: 'redirect not followed' } : {}) };
};

export interface ApiWebhooksAuditLog {
  tenantId: string; userId: string; role: string; actionType: string; entityType: string; entityId?: string;
  metadata?: Record<string, unknown>; createdAt: string;
}

export class ApiWebhooksService {
  private audit: ApiWebhooksAuditLog[] = [];
  constructor(private readonly repo: ApiWebhooksRepositoryPort, private readonly now: () => number = () => Date.now(), private readonly sender: WebhookSender = defaultSender, private readonly logs?: LogSink) {}

  private assertUser(ctx: ApiWebhooksContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('API keys & webhooks are not available for this role');
  }
  private need(ctx: ApiWebhooksContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private needOwner(ctx: ApiWebhooksContext, perm: string) { this.need(ctx, perm); if ((ctx.role || '').toUpperCase() !== 'OWNER') throw new ForbiddenError('Owner role required for secret-minting actions'); }
  private log(ctx: ApiWebhooksContext, actionType: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
    this.audit.push({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, metadata, createdAt: new Date(this.now()).toISOString() });
  }
  auditLog(): ApiWebhooksAuditLog[] { return this.audit.slice(); }

  private async emit(ctx: ApiWebhooksContext, severity: 'info' | 'warning' | 'error', source: string, message: string, relatedId?: string, status?: string) {
    await this.logs?.write({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, { category: 'integration', severity, source, message, relatedId, status });
  }

  private keyView(k: StoredKey): ApiKeyView {
    return { id: k.id, name: k.name, prefix: k.prefix, masked: maskedKey(k.prefix), environment: k.environment, scopes: k.scopes,
      status: keyStatus({ revokedMs: k.revokedMs, expiresMs: k.expiresMs }, this.now()), createdByUserId: k.createdByUserId,
      lastUsedIso: iso(k.lastUsedMs), expiresIso: iso(k.expiresMs), createdIso: iso(k.createdMs) };
  }
  private hookView(w: StoredWebhook): WebhookView {
    return { id: w.id, name: w.name, url: w.url, events: w.events, status: (w.status as any), hasSecret: true,
      lastDeliveryIso: iso(w.lastDeliveryMs), lastSuccessIso: iso(w.lastSuccessMs), lastFailureIso: iso(w.lastFailureMs), failureCount: w.failureCount, createdIso: iso(w.createdMs) };
  }

  // ---- API keys ----
  async listKeys(ctx: ApiWebhooksContext): Promise<ApiKeyView[]> {
    this.need(ctx, 'pos.api_keys.view');
    return (await this.repo.listKeys(ctx)).map((k) => this.keyView(k));
  }
  async createKey(ctx: ApiWebhooksContext, req: CreateApiKeyRequest): Promise<ApiKeyCreated> {
    this.needOwner(ctx, 'pos.api_keys.manage');
    const name = (req.name || '').trim();
    if (!name) throw withCode(new ValidationError('API key name is required'), 'API_KEY_NAME_REQUIRED');
    const environment = req.environment === 'test' ? 'test' : 'live';
    // Constitution 3 §76–78: a key's scopes are real permission keys from the integration allow-list (read-only today)
    const scopes = integrationPermissions(normalizeScopes(req.scopes));
    let expiresMs: number | null = null;
    if (req.expiresAt) { const t = Date.parse(req.expiresAt); if (Number.isNaN(t)) throw withCode(new ValidationError('Invalid expiresAt'), 'EXPIRY_INVALID'); expiresMs = t; }
    const { raw, prefix } = composeKey(environment, randToken());
    const stored = await this.repo.insertKey(ctx, { name, prefix, secretHash: sha256(raw), environment, scopes, createdByUserId: ctx.userId, expiresMs });
    this.log(ctx, 'api_key_created', 'tenant_api_key', stored.id, { prefix, environment, scopes });
    await this.emit(ctx, 'info', 'api_key', `API key “${name}” created`, stored.id, 'created');
    return { ...this.keyView(stored), secret: raw }; // raw shown ONCE
  }
  async rotateKey(ctx: ApiWebhooksContext, id: string): Promise<ApiKeyCreated> {
    this.needOwner(ctx, 'pos.api_keys.manage');
    const existing = await this.repo.getKey(ctx, id);
    if (!existing || existing.revokedMs != null) throw withCode(new NotFoundError('API key not found'), 'API_KEY_NOT_FOUND');
    const { raw, prefix } = composeKey(existing.environment, randToken());
    const stored = await this.repo.rotateKey(ctx, id, sha256(raw), prefix);
    if (!stored) throw withCode(new NotFoundError('API key not found'), 'API_KEY_NOT_FOUND');
    this.log(ctx, 'api_key_rotated', 'tenant_api_key', id, { prefix });
    await this.emit(ctx, 'info', 'api_key', `API key “${existing.name}” rotated`, id, 'rotated');
    return { ...this.keyView(stored), secret: raw };
  }
  async revokeKey(ctx: ApiWebhooksContext, id: string): Promise<{ id: string; revoked: boolean }> {
    this.need(ctx, 'pos.api_keys.manage');
    const okk = await this.repo.revokeKey(ctx, id);
    if (!okk) throw withCode(new NotFoundError('API key not found'), 'API_KEY_NOT_FOUND');
    this.log(ctx, 'api_key_revoked', 'tenant_api_key', id);
    await this.emit(ctx, 'warning', 'api_key', 'API key revoked', id, 'revoked');
    return { id, revoked: true };
  }

  // ---- Webhooks ----
  async listWebhooks(ctx: ApiWebhooksContext): Promise<WebhookView[]> {
    this.need(ctx, 'pos.webhooks.view');
    return (await this.repo.listWebhooks(ctx)).map((w) => this.hookView(w));
  }
  async createWebhook(ctx: ApiWebhooksContext, req: CreateWebhookRequest): Promise<WebhookCreated> {
    this.needOwner(ctx, 'pos.webhooks.manage');
    const name = (req.name || '').trim();
    if (!name) throw withCode(new ValidationError('Webhook name is required'), 'WEBHOOK_NAME_REQUIRED');
    const url = (req.url || '').trim();
    const safe = isSafeWebhookUrl(url);
    if (!safe.ok) throw new ValidationError(safe.reason || 'Unsafe webhook URL');
    const events = normalizeEvents(req.events);
    const signingSecret = randSigningSecret();
    const stored = await this.repo.insertWebhook(ctx, { name, url, events, signingSecretEnc: encryptSecret(signingSecret), createdByUserId: ctx.userId });
    this.log(ctx, 'webhook_created', 'tenant_webhook', stored.id, { url, events });
    await this.emit(ctx, 'info', 'webhook', `Webhook “${name}” created`, stored.id, 'created');
    return { ...this.hookView(stored), signingSecret }; // raw shown ONCE
  }
  private async setStatus(ctx: ApiWebhooksContext, id: string, status: 'active' | 'paused' | 'disabled', action: string): Promise<WebhookView> {
    this.need(ctx, 'pos.webhooks.manage');
    const okk = await this.repo.setWebhookStatus(ctx, id, status);
    if (!okk) throw withCode(new NotFoundError('Webhook not found'), 'WEBHOOK_NOT_FOUND');
    this.log(ctx, action, 'tenant_webhook', id, { status });
    await this.emit(ctx, status === 'disabled' ? 'warning' : 'info', 'webhook', `Webhook status changed to ${status}`, id, status);
    const w = await this.repo.getWebhook(ctx, id);
    if (!w) throw withCode(new NotFoundError('Webhook not found'), 'WEBHOOK_NOT_FOUND');
    return this.hookView(w);
  }
  pauseWebhook(ctx: ApiWebhooksContext, id: string) { return this.setStatus(ctx, id, 'paused', 'webhook_paused'); }
  resumeWebhook(ctx: ApiWebhooksContext, id: string) { return this.setStatus(ctx, id, 'active', 'webhook_resumed'); }
  disableWebhook(ctx: ApiWebhooksContext, id: string) { return this.setStatus(ctx, id, 'disabled', 'webhook_disabled'); }

  async rotateWebhookSecret(ctx: ApiWebhooksContext, id: string): Promise<{ id: string; signingSecret: string }> {
    this.needOwner(ctx, 'pos.webhooks.manage');
    const signingSecret = randSigningSecret();
    const okk = await this.repo.rotateWebhookSecret(ctx, id, encryptSecret(signingSecret));
    if (!okk) throw withCode(new NotFoundError('Webhook not found'), 'WEBHOOK_NOT_FOUND');
    this.log(ctx, 'webhook_secret_rotated', 'tenant_webhook', id);
    await this.emit(ctx, 'info', 'webhook', 'Webhook signing secret rotated', id, 'secret_rotated');
    return { id, signingSecret };
  }
  async testWebhook(ctx: ApiWebhooksContext, id: string): Promise<WebhookTestResult> {
    this.need(ctx, 'pos.webhooks.manage');
    const w = await this.repo.getWebhook(ctx, id);
    if (!w) throw withCode(new NotFoundError('Webhook not found'), 'WEBHOOK_NOT_FOUND');
    this.log(ctx, 'webhook_test_requested', 'tenant_webhook', id);
    const safe = isSafeWebhookUrl(w.url);
    if (!safe.ok) return { id, delivered: false, detail: safe.reason || 'Unsafe URL' };

    let secret: string;
    try { secret = decryptSecret(w.signingSecretEnc); }
    catch { return { id, delivered: false, detail: 'Signing secret unavailable — rotate the secret to re-enable delivery.' }; }
    const ts = Math.floor(this.now() / 1000);
    const body = buildEnvelope('webhook.test', 'evt_' + randomBytes(8).toString('hex'), ts, { message: 'Test event from AIPowerSalon', webhookId: id });
    const headers = { 'Content-Type': 'application/json', 'Webhook-Id': id, 'Webhook-Signature': signatureHeader(ts, sign(secret, ts, body)) };
    const res = await this.sender({ url: w.url, headers, body });
    await this.repo.recordDelivery(ctx, id, res.ok);
    this.log(ctx, res.ok ? 'webhook_test_delivered' : 'webhook_test_failed', 'tenant_webhook', id, { status: res.status });
    const host = (() => { try { return new URL(w.url).host; } catch { return w.url; } })();
    await this.logs?.write({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId }, { category: 'integration', severity: res.ok ? 'info' : 'error', source: 'webhook', message: `Test delivery to ${host} ${res.ok ? 'succeeded' : 'failed'}`, relatedId: id, status: res.ok ? 'delivered' : 'failed', metadata: { status: res.status } });
    const detail = res.ok ? `Signed test event delivered (HTTP ${res.status}).` : (res.error ? `Delivery failed: ${res.error}.` : `Endpoint returned HTTP ${res.status}.`);
    return { id, delivered: res.ok, detail };
  }
}
