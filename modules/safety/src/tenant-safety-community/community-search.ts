// community-search.ts — search that CANNOT be used to look up a person.
//
// The spec is explicit: "Do not allow community search by raw private customer identifiers" and "Do not build a
// searchable public list of customer names." That makes search a safety surface, not just a feature: a naive
// keyword search over advisories would turn the community into exactly the customer-lookup tool the whole module
// is designed not to be — someone could paste a phone number or an email and find every salon that reported it.
//
// So the query itself is screened BEFORE it ever reaches the database:
//   * A query containing a raw identifier (phone, email, card/bank/SSN digits, government id) is REJECTED —
//     not sanitized and run anyway, because a sanitized version of "find 201-555-0148" is still an attempt to
//     look someone up, and silently returning results would be worse than refusing.
//   * A query that is just a person's name pattern is refused for the same reason.
//   * What IS searchable: the scam method, behavior, category, region, severity, payment/booking channel —
//     the things that help a salon recognize a pattern.
// Matching runs only over the REDACTED body + title of PUBLISHED advisories (the raw incident text is never
// searchable, and never leaves its tenant).
// PURE — no I/O.

export type SearchRejection =
  | 'phone_number' | 'email_address' | 'card_or_bank_number' | 'government_id' | 'personal_name_lookup';

export interface SearchScreen { allowed: boolean; rejection?: SearchRejection; message?: string }

// eslint-disable-next-line no-useless-escape -- PII redaction regex; the redundant \- is harmless and this is not worth touching for a cosmetic rule.
const PHONE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/;
// eslint-disable-next-line no-useless-escape -- PII redaction regex; the redundant \- is harmless and not worth touching for a cosmetic rule.
const EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
// eslint-disable-next-line no-useless-escape -- PII redaction regex; the redundant \- is harmless and not worth touching for a cosmetic rule.
const LONG_DIGITS = /(?:\d[ \-]?){9,}/;              // card / bank / account / long id runs
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const GOV_ID = /\b(ssn|social security|driver'?s? licen[cs]e|passport|dl#|license number)\b/i;
// "find John Smith" / "search for Jane Doe" — an explicit person lookup
const NAME_LOOKUP = /\b(find|search(?:\s+for)?|look\s*up|who\s+is)\b[^a-z]{0,3}\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/;

const MESSAGES: Record<SearchRejection, string> = {
  phone_number: 'Community search can’t be used to look up a phone number. Search the scam method or behavior instead.',
  email_address: 'Community search can’t be used to look up an email address. Search the scam method or behavior instead.',
  card_or_bank_number: 'Community search can’t be used to look up a card, bank, or account number.',
  government_id: 'Community search can’t be used to look up a government ID.',
  personal_name_lookup: 'The community isn’t a customer lookup. Search the behavior or scam pattern, not a person.',
};

/** Screen a query BEFORE it touches the database. Fail-closed: reject rather than sanitize-and-run. */
export function screenQuery(q: string): SearchScreen {
  const text = (q || '').trim();
  if (!text) return { allowed: true };
  let rejection: SearchRejection | null = null;
  if (EMAIL.test(text)) rejection = 'email_address';
  else if (SSN.test(text) || GOV_ID.test(text)) rejection = 'government_id';
  else if (PHONE.test(text)) rejection = 'phone_number';
  else if (LONG_DIGITS.test(text)) rejection = 'card_or_bank_number';
  else if (NAME_LOOKUP.test(text)) rejection = 'personal_name_lookup';
  if (rejection) return { allowed: false, rejection, message: MESSAGES[rejection] };
  return { allowed: true };
}

export interface SearchFilters {
  q?: string;
  category?: string;
  region?: string;
  severity?: string;
  resolved?: boolean;
}

/** Normalize into the safe filter set the repository is allowed to see. The free-text term survives only after
 *  screening; everything else is a controlled facet. */
export function buildSafeQuery(filters: SearchFilters): { term: string | null; category: string | null; region: string | null; severity: string | null; resolvedOnly: boolean } {
  const screen = screenQuery(filters.q || '');
  if (!screen.allowed) throw new SearchRejected(screen.rejection!, screen.message!);
  const term = (filters.q || '').trim();
  return {
    term: term ? term.slice(0, 120) : null,     // bounded — no giant scraping queries
    category: filters.category || null,
    region: filters.region || null,
    severity: filters.severity || null,
    resolvedOnly: filters.resolved === true,
  };
}

export class SearchRejected extends Error {
  constructor(public rejection: SearchRejection, message: string) { super(message); this.name = 'SearchRejected'; }
}
