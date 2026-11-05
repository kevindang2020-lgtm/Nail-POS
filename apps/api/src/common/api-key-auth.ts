// api-key-auth.ts — Constitution 3 §76–78 (Step 7, Oct 3 2026): a tenant API key authenticates a request.
//   • presented as `X-API-Key: ak_…` or `Authorization: Bearer ak_…`; read BEFORE the session path;
//   • looked up by sha256 (the raw key is never stored); revoked or expired keys never match; after a rotation the
//     PREVIOUS secret keeps working until previous_valid_until (24 h) so an integration can switch without an outage;
//   • the request runs as an INTEGRATION principal whose permissions are EXACTLY the key's scopes, filtered through
//     INTEGRATION_SCOPES — read-only for now (a key has no user behind it, and writes record a real user as their author;
//     writes via keys need an integration actor designed first);
//   • only on salon (tenant-realm) routes — never /auth, /customer, /super-admin, /platform or /internal;
//   • every use goes to tenant_api_key_uses (fail-soft), and last_used_at is kept current.
import { createHash } from 'node:crypto';
import { sql } from 'kysely';

/** The permissions a key may carry. Anything else on a key grants nothing. Read-only by design (see header). */
export const INTEGRATION_SCOPES = [
  'pos.booking.view', 'pos.customers.view', 'pos.services.view', 'pos.queue.view', 'pos.reports.view', 'pos.checkout.view',
] as const;
export const ROTATION_OVERLAP_HOURS = 24;
export const integrationPermissions = (scopes: string[] | null | undefined): string[] => (scopes ?? []).filter((s) => (INTEGRATION_SCOPES as readonly string[]).includes(s));
export function readApiKey(headers: Record<string, any> | undefined): string | null {
  const h = headers ?? {};
  const x = h['x-api-key']; if (typeof x === 'string' && /^ak_[A-Za-z0-9_-]{16,200}$/.test(x.trim())) return x.trim();
  const auth = String(h.authorization ?? h.Authorization ?? '');
  const m = /^Bearer\s+(ak_[A-Za-z0-9_-]{16,200})$/i.exec(auth.trim()); return m ? m[1] : null;
}
/** Routes a key may call: the salon realm only. */
export function apiKeyRouteAllowed(path: string | undefined): boolean {
  const p = String(path ?? '').replace(/^\/api\/v1(?=\/)/, '').split('?')[0];
  return !/^\/(auth|customer|super-admin|platform|internal|jobs|public)(\/|$)/.test(p);
}
export interface VerifiedApiKey { keyId: string; tenantId: string; scopes: string[]; viaPreviousSecret: boolean }
export class KyselyApiKeyAuth {
  constructor(private readonly db: any) {}
  async verify(raw: string): Promise<VerifiedApiKey | null> {
    const h = createHash('sha256').update(raw).digest('hex');
    const r: any = (await sql`select id, tenant_id, scopes, (secret_hash = ${h}) as current from tenant_api_keys
      where (secret_hash = ${h} or (previous_secret_hash = ${h} and previous_valid_until > now()))
        and revoked_at is null and (expires_at is null or expires_at > now()) limit 1`.execute(this.db)).rows[0];
    if (!r) return null;
    return { keyId: String(r.id), tenantId: String(r.tenant_id), scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [], viaPreviousSecret: !r.current };
  }
  async recordUse(k: VerifiedApiKey, method: string, route: string, ip: string | null): Promise<void> {
    try {
      await sql`insert into tenant_api_key_uses (key_id, tenant_id, method, route, ip, via_previous_secret) values (${k.keyId}::uuid, ${k.tenantId}::uuid, ${String(method).slice(0, 10)}, ${String(route).split('?')[0].slice(0, 200)}, ${ip ? String(ip).slice(0, 64) : null}, ${k.viaPreviousSecret})`.execute(this.db);
      await sql`update tenant_api_keys set last_used_at = now() where id = ${k.keyId}::uuid and (last_used_at is null or last_used_at < now() - interval '1 minute')`.execute(this.db);
    } catch { /* the ledger never blocks the request */ }
  }
}
