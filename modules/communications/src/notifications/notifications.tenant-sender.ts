// notifications.tenant-sender.ts — resolves a per-tenant SMS sender from the tenant's own encrypted Twilio credentials
// (tenant_messaging_credentials, migration 311). When a tenant has configured its own Twilio account, its messages are
// sent through THAT account + from number; otherwise the caller falls back to the shared default sender. The auth token
// is decrypted here (server-side, in-process) only to construct the sender — it is never returned to any caller.
import { sql, type Kysely } from 'kysely';
import { TwilioSmsSender, type SmsSender } from '@aipowersalon/notifications';
import type { ProviderSecrets } from '@aipowersalon/security';

export interface TenantSmsSenderResolver { resolveSender(tenantId: string): Promise<SmsSender | null>; }

export class NullTenantSmsSenderResolver implements TenantSmsSenderResolver {
  async resolveSender(): Promise<SmsSender | null> { return null; }   // no per-tenant creds → use the shared default
}

export class KyselyTenantSmsSenderResolver implements TenantSmsSenderResolver {
  // Credentials are opened through the ProviderSecrets port (Constitution 13 §94) — this class never touches the key ring.
  constructor(private readonly db: Kysely<any>, private readonly secrets: Pick<ProviderSecrets, 'decrypt'>, private readonly http: typeof fetch = fetch) {}
  async resolveSender(tenantId: string): Promise<SmsSender | null> {
    const res: any = await sql`
      SELECT account_sid, auth_token_enc, from_number, messaging_service_sid FROM tenant_messaging_credentials
      WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND status = 'configured' AND branch_id IS NULL LIMIT 1   -- the salon default (Phase 4: branch rows may exist)
    `.execute(this.db);
    const row = res.rows?.[0];
    // wave 3 PAYI §60: the salon's Messaging Service (MG…) is the sender when set; else its from number
    const sender = row?.messaging_service_sid || row?.from_number;
    if (!row?.account_sid || !row?.auth_token_enc || !sender) return null;   // incomplete → fall back
    let authToken: string;
    try { authToken = this.secrets.decrypt(row.auth_token_enc); } catch { return null; }       // undecryptable → fall back, never crash a send
    return new TwilioSmsSender({ accountSid: row.account_sid, authToken, from: String(sender) }, this.http);
  }
}
