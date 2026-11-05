// ai-marketing-results.ts — PURE per-campaign results composition. Reads the campaign row counters (already
// populated by the delivery/attribution flow) and presents an honest funnel: rates are null when their
// denominator is zero (no fabricated ratios), cost-per-booking is null with zero bookings, and revenue is
// labeled ASSOCIATED (correlation) — never presented as proven causation.
import type { CampaignRow } from '@aipowersalon/communications';

// Optional per-recipient ledger tallies (from migration 320) — present once the Kysely SendLedger adapter is
// wired. Until then results still render honestly from the campaign counters alone.
export interface LedgerCounts {
  attempted: number;
  sent: number;
  skipped: number;
  blocked: number;
  failed: number;
}

export interface CampaignResults {
  campaignId: string;
  name: string;
  status: string;
  channel: string;
  audienceSize: number;
  funnel: { sent: number; opened: number; clicked: number; booked: number };
  rates: { openRate: number | null; clickRate: number | null; bookingRate: number | null };
  costCents: number;
  associatedRevenueCents: number; // correlation, not causation — see `disclaimer`
  costPerBookingCents: number | null; // null when there are no bookings
  revenuePerSentCents: number | null; // null when nothing was sent
  ledger: LedgerCounts | null;
  disclaimer: string;
  generatedAt: string;
}

function rate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null; // never fabricate a ratio from a zero denominator
  return Math.round((numerator / denominator) * 10000) / 10000; // 4 dp
}

export const RESULTS_DISCLAIMER =
  'Revenue shown is associated with customers who booked through this campaign (correlation), not a proven causal effect.';

export function buildResults(
  c: CampaignRow,
  ledger: LedgerCounts | null,
  generatedAt: string,
  attributedBooked?: number | null,
): CampaignResults {
  const sent = c.sentCount || 0;
  const opened = c.openCount || 0;
  const clicked = c.clickCount || 0;
  // Prefer REAL attribution (BOOKING_SUCCEEDED events stamped with campaign_id) over the campaigns.booking_count
  // counter, which is never incremented. Falls back to the counter only when attribution isn't supplied.
  const booked = attributedBooked != null ? attributedBooked : (c.bookingCount || 0);
  return {
    campaignId: c.id,
    name: c.name,
    status: c.status,
    channel: c.channel,
    audienceSize: c.audienceSize || 0,
    funnel: { sent, opened, clicked, booked },
    rates: {
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      bookingRate: rate(booked, sent),
    },
    costCents: c.costCents || 0,
    associatedRevenueCents: c.revenueCents || 0,
    costPerBookingCents: booked > 0 ? Math.round((c.costCents || 0) / booked) : null,
    revenuePerSentCents: sent > 0 ? Math.round((c.revenueCents || 0) / sent) : null,
    ledger: ledger ?? null,
    disclaimer: RESULTS_DISCLAIMER,
    generatedAt,
  };
}
