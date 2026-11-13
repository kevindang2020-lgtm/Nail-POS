// customer-intelligence-360.ts — Customer Intelligence 30 (extras, Nov 13 2026): the Customer 360-Degree Intelligence view
// (GET /pos/customer-intelligence/customers/:id/360). One read that joins what the owning modules already know — the approved
// identity (Customer Management), completed service history (settled tickets), preferences, loyalty / membership — with
// evidence-backed REVIEW suggestions. Suggestions are advisory: nothing here books, messages, merges or changes points.
export type Ci360IdentityState = 'verified' | 'unverified' | 'possible_duplicate';

export interface Ci360Identity {
  name: string | null; phone: string | null; email: string | null; contact: 'full' | 'masked';
  phoneVerified: boolean; state: Ci360IdentityState; createdAt: string | null; preferredLanguage: string | null;
}
export interface Ci360Visit { ticketId: string; date: string | null; services: string[]; technician: string | null; totalCents: number; branch: string | null }
export interface Ci360Preferences { preferredTechnician: string | null; style: string | null; products: string[]; colors: string[] }
export interface Ci360Loyalty { points: number | null; tier: string | null; membership: { plan: string | null; status: string } | null }
export type Ci360SuggestionCode = 'rebook_review' | 'verify_phone' | 'add_contact' | 'review_duplicate' | 'retention_at_risk';
export interface Ci360Suggestion { code: Ci360SuggestionCode; evidence: string[] }

export interface Customer360 {
  customerId: string;
  identity: Ci360Identity;
  classification: { status: string | null; completedVisits: number; lastVisitAt: string | null; typicalIntervalDays: number | null; nextAppointmentDate: string | null; computedAt: string | null } | null;
  visits: Ci360Visit[]; visitsTotal: number; lifetimeSpendCents: number;
  preferences: Ci360Preferences;
  loyalty: Ci360Loyalty;
  suggestions: Ci360Suggestion[];
}
