// ai-marketing-conversions.ts — reads REAL per-campaign booking attribution from ai_booking_conversion_events
// (now carrying campaign_id, migration 322). A booking made through a campaign link records a BOOKING_SUCCEEDED
// event stamped with campaign_id; counting those gives honest, per-campaign booked attribution — replacing the
// campaigns.booking_count counter, which is never incremented.
//
// Raw `sql` is used (matching AiBookingConversionService's own pattern — this table isn't in the Kysely DB type).
// ⚠️ the Kysely adapter is DB glue → smoke-test on seeded Postgres. The in-memory adapter backs unit tests.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface CampaignConversionsPort {
  // Count of succeeded bookings attributed to this campaign (tenant-scoped).
  bookedByCampaign(tenantId: string, campaignId: string): Promise<number>;
}

export class KyselyCampaignConversions implements CampaignConversionsPort {
  constructor(private readonly db: Kysely<DB>) {}
  async bookedByCampaign(tenantId: string, campaignId: string): Promise<number> {
    try {
      const r: any = await sql`
        SELECT count(*)::int AS n
        FROM ai_booking_conversion_events
        WHERE tenant_id = ${tenantId} AND campaign_id = ${campaignId}
          AND stage = 'BOOKING_SUCCEEDED' AND (outcome = 'succeeded' OR outcome IS NULL)
      `.execute(this.db as any);
      return Number(r?.rows?.[0]?.n || 0);
    } catch {
      return 0; // honest zero on failure — never a fabricated attribution
    }
  }
}

// In-memory adapter (tests/dev): seedable per tenant+campaign.
export class InMemoryCampaignConversions implements CampaignConversionsPort {
  private m = new Map<string, number>();
  private k(t: string, c: string) { return t + '|' + c; }
  seed(tenantId: string, campaignId: string, booked: number): void { this.m.set(this.k(tenantId, campaignId), booked); }
  async bookedByCampaign(tenantId: string, campaignId: string): Promise<number> { return this.m.get(this.k(tenantId, campaignId)) ?? 0; }
}
