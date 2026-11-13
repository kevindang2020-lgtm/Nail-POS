// ai-price-table.ts — AI Usage Limits 07 (extras round 11): the Super Admin AI price table as a salon sees it on its AI Usage
// cards. The table starts EMPTY (nothing seeded): until a version is published every card says "no price set" and today's
// price source is unchanged. Integer cents.
export type AiPriceUnit = 'month' | 'year' | 'overage_unit';
export interface AiPriceUpcoming { versionNo: number; effectiveFrom: string; priceCents: number | null; existingSalonsKeepPrevious: boolean }
export type AiTablePrice =
  | { state: 'no_price_set'; unit: AiPriceUnit; reason: 'no_version_published' | 'not_in_version' | 'kept_previous_none'; currentVersionNo: number | null; upcoming: AiPriceUpcoming | null }
  | { state: 'set'; unit: AiPriceUnit; priceCents: number; source: 'version' | 'salon_override'; versionNo: number | null; effectiveFrom: string; keptPrevious: boolean; currentVersionNo: number | null; upcoming: AiPriceUpcoming | null };
