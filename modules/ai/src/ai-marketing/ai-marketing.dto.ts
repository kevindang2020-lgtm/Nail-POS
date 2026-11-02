// ai-marketing.dto.ts — AI Marketing Assistant read-model types + PURE builders (no side effects, no I/O).
// Slice 1 = recommendation/read layer only. There is NO send path here (safest first increment).
//
// CRITICAL invariants encoded in this file:
//  - The AI layer NEVER fabricates an offer, discount, price, expiration, service, or policy.
//    Every recommendation carries `offer: null` and `requiresOffer` so a human must enter/approve the offer
//    through the existing promotion workflow before anything can be sent.
//  - Revenue is described as ASSOCIATED (correlation), never "caused" — see CommandCenterSummary field docs.
//  - Tenant/branch identity is server-derived (AiMarketingContext), never client-supplied.

export interface AiMarketingContext {
  tenantId: string;
  branchId: string; // '' = tenant-wide caller (owner); non-empty = branch-scoped
  userId: string;
  role: string;
  permissions: string[];
}

export type CampaignChannel = 'sms' | 'email' | 'push';

export type RecommendationType =
  | 'rebooking'
  | 'inactive_customer'
  | 'birthday'
  | 'last_minute_opening';

// A read-model of REAL, tenant-scoped counts the repository computes from existing tables
// (campaigns, customers, appointments, notification_opt_outs). No raw model-generated SQL is ever used.
export interface MarketingReadModel {
  campaignCounts: { active: number; scheduled: number; draft: number; completed: number };
  campaignTotals: { sent: number; bookings: number; revenueCents: number; costCents: number };
  consent: { optedInSms: number; optedInEmail: number; suppressed: number };
  audiences: {
    rebookingDue: EligibleAudience;
    inactive90: EligibleAudience;
    birthdayThisMonth: EligibleAudience;
    lastMinuteInterest: EligibleAudience;
  };
}

// eligible = passes consent + has usable contact; suppressed = excluded (opted-out / missing contact / cap).
export interface EligibleAudience {
  eligible: number;
  suppressed: number;
}

export interface CommandCenterSummary {
  activeCampaigns: number;
  scheduledCampaigns: number;
  draftCampaigns: number;
  completedCampaigns: number;
  messagesSent: number;
  bookingsAttributed: number;
  // ASSOCIATED revenue: customers who booked via campaign links. NOT a causal claim. UI must render it as
  // "associated with", never "created by". Value in integer cents (BIGINT upstream).
  revenueAssociatedCents: number;
  messageCostCents: number;
  // null (renders as em-dash upstream) when bookings = 0 — we never fabricate a divide-by-zero number.
  costPerBookingCents: number | null;
  suppressedContacts: number; // size of the tenant suppression surface (opt-outs)
  optedInSms: number;
  optedInEmail: number;
  generatedAt: string;
}

export interface CampaignRecommendation {
  type: RecommendationType;
  title: string;
  goal: string;
  evidence: string; // derived ONLY from real counts in MarketingReadModel
  audienceEstimate: number; // consent-filtered eligible count (real)
  suppressedEstimate: number; // excluded count (real)
  branchScope: 'branch' | 'tenant';
  suggestedChannel: CampaignChannel;
  requiresOffer: boolean; // true → a human must supply/approve the offer; the AI supplies none
  offer: null; // ALWAYS null in this layer — the AI never invents an offer/discount/price/expiration
  risks: string[];
  confidence: 'low' | 'medium' | 'high';
  supportingMetric: string;
}

export interface AiMarketingState {
  summary: CommandCenterSummary;
  recommendations: CampaignRecommendation[];
  // freshness/honesty: makes it explicit these are read-model aggregates (Section 50 "expose freshness").
  freshness: { generatedAt: string; source: 'live_read_model' };
}

// ---------------------------------------------------------------------------
// PURE BUILDERS — deterministic, no I/O. Unit-tested directly.
// ---------------------------------------------------------------------------

// Only surface a recommendation when the eligible audience clears a floor, to avoid noise on tiny/empty salons.
export const MIN_ELIGIBLE_FOR_RECOMMENDATION = 5;

function confidenceFor(eligible: number): 'low' | 'medium' | 'high' {
  if (eligible >= 150) return 'high';
  if (eligible >= 40) return 'medium';
  return 'low';
}

export function buildSummary(model: MarketingReadModel, generatedAt: string): CommandCenterSummary {
  const bookings = model.campaignTotals.bookings;
  return {
    activeCampaigns: model.campaignCounts.active,
    scheduledCampaigns: model.campaignCounts.scheduled,
    draftCampaigns: model.campaignCounts.draft,
    completedCampaigns: model.campaignCounts.completed,
    messagesSent: model.campaignTotals.sent,
    bookingsAttributed: bookings,
    revenueAssociatedCents: model.campaignTotals.revenueCents,
    messageCostCents: model.campaignTotals.costCents,
    costPerBookingCents: bookings > 0 ? Math.round(model.campaignTotals.costCents / bookings) : null,
    suppressedContacts: model.consent.suppressed,
    optedInSms: model.consent.optedInSms,
    optedInEmail: model.consent.optedInEmail,
    generatedAt,
  };
}

export function buildRecommendations(
  model: MarketingReadModel,
  branchScope: 'branch' | 'tenant',
): CampaignRecommendation[] {
  const out: CampaignRecommendation[] = [];
  const a = model.audiences;

  if (a.rebookingDue.eligible >= MIN_ELIGIBLE_FOR_RECOMMENDATION) {
    out.push({
      type: 'rebooking',
      title: 'Rebook customers due for their next visit',
      goal: 'Bring back customers whose last completed visit is past your typical rebooking window.',
      evidence: `${a.rebookingDue.eligible} consented customers completed a visit outside the rebooking window and have no upcoming appointment.`,
      audienceEstimate: a.rebookingDue.eligible,
      suppressedEstimate: a.rebookingDue.suppressed,
      branchScope,
      suggestedChannel: 'sms',
      requiresOffer: false, // a neutral "time for your next visit" reminder can run without a discount
      offer: null,
      risks: ['Do not use "overdue" wording unless the tenant approves it.'],
      confidence: confidenceFor(a.rebookingDue.eligible),
      supportingMetric: 'appointments (completed) + no future appointment',
    });
  }

  if (a.inactive90.eligible >= MIN_ELIGIBLE_FOR_RECOMMENDATION) {
    out.push({
      type: 'inactive_customer',
      title: 'Re-engage customers inactive for 90+ days',
      goal: 'Win back customers who have not visited in over 90 days.',
      evidence: `${a.inactive90.eligible} consented customers have no visit in the last 90 days and no upcoming appointment.`,
      audienceEstimate: a.inactive90.eligible,
      suppressedEstimate: a.inactive90.suppressed,
      branchScope,
      suggestedChannel: 'sms',
      requiresOffer: true, // win-back usually needs a human-approved incentive; the AI supplies none
      offer: null,
      risks: ['Use respectful wording — do not shame customers for not visiting.'],
      confidence: confidenceFor(a.inactive90.eligible),
      supportingMetric: 'last completed visit older than 90 days',
    });
  }

  if (a.birthdayThisMonth.eligible >= MIN_ELIGIBLE_FOR_RECOMMENDATION) {
    out.push({
      type: 'birthday',
      title: 'Birthday campaign for customers with a birthday this month',
      goal: 'Send birthday goodwill (optionally with an approved offer) to customers celebrating this month.',
      evidence: `${a.birthdayThisMonth.eligible} consented customers have a stored birthday this month.`,
      audienceEstimate: a.birthdayThisMonth.eligible,
      suppressedEstimate: a.birthdayThisMonth.suppressed,
      branchScope,
      suggestedChannel: 'sms',
      requiresOffer: true, // any birthday discount must be human-entered/approved; never fabricated
      offer: null,
      risks: ['Do not disclose age. Do not fabricate a birthday discount.'],
      confidence: confidenceFor(a.birthdayThisMonth.eligible),
      supportingMetric: 'customers.birthday month = current month',
    });
  }

  // last_minute_opening intentionally omitted from slice 1: it requires live availability, which is wired
  // in a later slice. We surface honest zero rather than a fabricated "openings available" claim.

  return out;
}
