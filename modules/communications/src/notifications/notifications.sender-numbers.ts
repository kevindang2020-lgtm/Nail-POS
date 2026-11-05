// notifications.sender-numbers.ts — resolves the FROM number for a tenant's outbound SMS. At scale each tenant sends
// from its own registered Twilio number (tenant_messaging_numbers, migration 309); when a tenant has no registered
// number the caller falls back to the shared TWILIO_FROM. This keeps sends attributable per tenant for A2P without
// forcing every tenant to have a number on day one.
import { sql, type Kysely } from 'kysely';

export interface SenderNumberResolver { resolveFrom(tenantId: string): Promise<string | null>; }

export class NullSenderNumberResolver implements SenderNumberResolver {
  async resolveFrom(): Promise<string | null> { return null; }   // no registry (e.g. tests) → use the default from
}

export class KyselySenderNumberResolver implements SenderNumberResolver {
  constructor(private readonly db: Kysely<any>) {}
  /**
   * wave 3 PAYI §60: the sender is the salon's Messaging Service (MG…) when its A2P campaign is registered on one —
   * Twilio then picks the number from the service's pool under the approved campaign — else the salon's ACTIVE
   * registered number (a released / suspended number is never used). Both are keyed by THIS tenant id.
   */
  async resolveFrom(tenantId: string): Promise<string | null> {
    const a2p: any = await sql`
      SELECT messaging_service_sid FROM tenant_a2p_registrations
      WHERE tenant_id = ${tenantId} AND messaging_service_sid IS NOT NULL AND campaign_status IN ('VERIFIED', 'verified', 'APPROVED', 'approved', 'active', 'ACTIVE') LIMIT 1
    `.execute(this.db).catch(() => ({ rows: [] }));
    if (a2p.rows?.[0]?.messaging_service_sid) return String(a2p.rows[0].messaging_service_sid);
    const res: any = await sql`
      SELECT phone_number FROM tenant_messaging_numbers
      WHERE tenant_id = ${tenantId} AND channel = 'sms' AND status = 'active' AND purpose IN ('general_sms', 'booking', 'marketing') ORDER BY created_at ASC LIMIT 1
    `.execute(this.db);
    return res.rows?.[0]?.phone_number ?? null;
  }
}
