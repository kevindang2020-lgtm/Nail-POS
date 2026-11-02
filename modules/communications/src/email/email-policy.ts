// email-policy.ts — what the ONE email send path (NotificationsService.sendEmail) needs to know before a provider is called
// (Email Complete Build Guide, Oct 31 2026). Raw SQL; no second email store — the ledger stays `notifications`.
//
//   settings        the salon's Communications → Email settings as the send path must honour them: display name, reply-to,
//                   "Send booking confirmations by email", "Email receipts to customers". Read from the canonical
//                   tenant_settings 'notifications' JSON (defaults ← salon row ← branch row) — the same values the page saves.
//                   The display name is the salon's EMAIL sender name: the A2P (SMS) brand is never substituted for it.
//   claim / attach  claim-before-send (748 email_send_keys): one key → one attempt, whatever retries, replays or concurrent
//                   workers do. A claim that never got its notification (crash mid-send) reads back as "unknown".
//   marketing       CAN-SPAM: every marketing email carries the salon's physical address and a one-click unsubscribe
//                   (link + List-Unsubscribe / List-Unsubscribe-Post headers). Without an address or a signing secret
//                   (production) marketing email is refused — never sent without a way out.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { logException } from '@aipowersalon/observability';

export interface EmailSettings { senderName: string; replyTo: string | null; bookingConfirmations: boolean; receipts: boolean; source: 'default' | 'tenant' | 'branch' }
export type EmailClaim = { claimed: true } | { claimed: false; notificationId: string | null };
export interface MarketingCompliance { ok: true; footer: string; headers: Record<string, string> }
export type MarketingRefusal = { ok: false; reason: 'no_physical_address' | 'unsubscribe_not_configured' };

export interface EmailPolicyPort {
  settings(tenantId: string, branchId: string | null): Promise<EmailSettings>;
  claim(tenantId: string, key: string, category: string): Promise<EmailClaim>;
  attach(tenantId: string, key: string, notificationId: string): Promise<void>;
  /** the status of a previously claimed attempt (for a duplicate's answer) */
  attemptOf(tenantId: string, notificationId: string): Promise<{ status: string; providerId: string | null; reason: string | null } | null>;
  marketing(tenantId: string, branchId: string | null, to: string): Promise<MarketingCompliance | MarketingRefusal>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** JSON that may be a string or already parsed; unreadable → logged, treated as "nothing saved" (the defaults apply) */
function jsonOf(v: unknown, where: string): unknown {
  if (typeof v !== 'string') return v;
  let o: unknown = null;
  try { o = JSON.parse(v); } catch (e) { logException(e, { where }); }
  return o;
}
const parse = (v: unknown): Record<string, unknown> => { const o = jsonOf(v, 'email-policy.settings'); return o && typeof o === 'object' ? (o as Record<string, unknown>) : {}; };

/** the defaults the settings page shows for a salon that never saved (settings.dto DEFAULT_SETTINGS.notifications) */
export const EMAIL_SETTING_DEFAULTS = { emailConfirmation: true, receiptDelivery: ['SMS', 'Email'], senderBrand: 'AIPowerSalon' } as const;

/** effective settings from the stored rows (pure — tested directly) */
export function effectiveEmailSettings(tenantRow: Record<string, unknown> | null, branchRow: Record<string, unknown> | null, salonName: string | null): EmailSettings {
  const merged: Record<string, unknown> = { ...EMAIL_SETTING_DEFAULTS, ...(tenantRow ?? {}), ...(branchRow ?? {}) };
  const name = String(merged.emailSenderName ?? merged.senderBrand ?? '').trim() || String(salonName ?? '').trim() || 'AIPowerSalon';
  const reply = String(merged.emailReplyTo ?? '').trim().toLowerCase();
  const receipts = Array.isArray(merged.receiptDelivery) && (merged.receiptDelivery as unknown[]).some((x) => String(x).toLowerCase() === 'email');
  return { senderName: name.slice(0, 80), replyTo: EMAIL_RE.test(reply) ? reply : null, bookingConfirmations: merged.emailConfirmation !== false, receipts,
    source: branchRow ? 'branch' : tenantRow ? 'tenant' : 'default' };
}

// ── unsubscribe tokens (HMAC — no lookup table, nothing guessable) ───────────────────────────────────────────────────
export function unsubscribeSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = String(env.EMAIL_UNSUBSCRIBE_SECRET ?? '').trim();
  if (s.length >= 16) return s;
  return env.NODE_ENV === 'production' ? null : 'development-only-unsubscribe-secret';   // never used in production
}
export function publicApiBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const b = String(env.PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(b) || (env.NODE_ENV !== 'production' && /^http:\/\//i.test(b))) return b;
  return env.NODE_ENV === 'production' ? null : 'http://localhost:3000';
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
export function signUnsubscribe(tenantId: string, address: string, secret: string): string {
  const payload = b64(JSON.stringify({ t: tenantId, a: address.toLowerCase(), p: 'marketing' }));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export function verifyUnsubscribe(token: string, secret: string): { tenantId: string; address: string } | null {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  // the signature matched, so the payload is ours: it always parses
  const o = jsonOf(Buffer.from(payload, 'base64url').toString('utf8'), 'email-policy.unsubscribe') as { t?: unknown; a?: unknown } | null;
  return o && UUID.test(String(o.t)) && EMAIL_RE.test(String(o.a)) ? { tenantId: String(o.t), address: String(o.a) } : null;
}

export class KyselyEmailPolicy implements EmailPolicyPort {
  constructor(private readonly db: Kysely<any>, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async settings(tenantId: string, branchId: string | null): Promise<EmailSettings> {
    const rows = (await sql<any>`select branch_id, settings_json from tenant_settings where tenant_id = ${tenantId}::uuid and category = 'notifications'
        and (branch_id is null or ${branchId && UUID.test(branchId) ? sql`branch_id = ${branchId}::uuid` : sql`false`})`.execute(this.db)).rows;
    const tenantRow = rows.find((r: any) => r.branch_id == null); const branchRow = rows.find((r: any) => r.branch_id != null);
    const salon = (await sql<any>`select coalesce(nullif(display_name, ''), legal_name) as name from tenants where id = ${tenantId}::uuid`.execute(this.db)).rows[0]?.name ?? null;
    return effectiveEmailSettings(tenantRow ? parse(tenantRow.settings_json) : null, branchRow ? parse(branchRow.settings_json) : null, salon);
  }
  async claim(tenantId: string, key: string, category: string): Promise<EmailClaim> {
    const cat = ['booking_confirmation', 'receipt', 'test', 'manual', 'marketing'].includes(category) ? category : 'other';
    const ins = (await sql<any>`insert into email_send_keys (tenant_id, idempotency_key, category) values (${tenantId}::uuid, ${key}, ${cat})
        on conflict (tenant_id, idempotency_key) do nothing returning idempotency_key`.execute(this.db)).rows;
    if (ins.length) return { claimed: true };
    const r = (await sql<any>`select notification_id from email_send_keys where tenant_id = ${tenantId}::uuid and idempotency_key = ${key}`.execute(this.db)).rows[0];
    return { claimed: false, notificationId: r?.notification_id ? String(r.notification_id) : null };
  }
  async attach(tenantId: string, key: string, notificationId: string): Promise<void> {
    await sql`update email_send_keys set notification_id = ${notificationId}::uuid where tenant_id = ${tenantId}::uuid and idempotency_key = ${key} and notification_id is null`.execute(this.db);
  }
  async attemptOf(tenantId: string, notificationId: string) {
    const r = (await sql<any>`select status, provider_id, failure_reason from notifications where tenant_id = ${tenantId}::uuid and id = ${notificationId}::uuid`.execute(this.db)).rows[0];
    return r ? { status: String(r.status), providerId: r.provider_id ?? null, reason: r.failure_reason ?? null } : null;
  }
  async marketing(tenantId: string, branchId: string | null, to: string): Promise<MarketingCompliance | MarketingRefusal> {
    const b = (await sql<any>`select b.name, b.address, b.address_line2, b.city, b.state, b.zip, coalesce(nullif(t.display_name, ''), t.legal_name) as salon
        from branches b join tenants t on t.id = b.tenant_id where b.tenant_id = ${tenantId}::uuid
         and ${branchId && UUID.test(branchId) ? sql`b.id = ${branchId}::uuid` : sql`true`} and coalesce(b.address, '') <> ''
       order by b.created_at limit 1`.execute(this.db)).rows[0];
    if (!b) return { ok: false, reason: 'no_physical_address' };
    const secret = unsubscribeSecret(this.env); const base = publicApiBase(this.env);
    if (!secret || !base) return { ok: false, reason: 'unsubscribe_not_configured' };
    const url = `${base}/public/email/unsubscribe?token=${encodeURIComponent(signUnsubscribe(tenantId, to, secret))}`;
    const address = [b.address, b.address_line2, [b.city, b.state].filter(Boolean).join(', '), b.zip].map((x: any) => String(x ?? '').trim()).filter(Boolean).join(', ');
    const footer = `\n\n—\n${String(b.salon ?? '').trim()} · ${address}\nYou are receiving this because you agreed to hear from us. Unsubscribe: ${url}`;
    return { ok: true, footer, headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
  }
}
