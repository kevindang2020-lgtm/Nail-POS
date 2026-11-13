// ai-price-table.ts — AI Usage Limits 07 (extras round 11): Super Admin → the AI price table (versions + per-salon overrides).
// Append-only; existingSalonsKeepPrevious is a REQUIRED choice per version (no default). Integer cents.
import type { AiPriceUnit } from '../tenant/ai-price-table';
export type { AiPriceUnit } from '../tenant/ai-price-table';
export interface AiPriceVersionView { versionNo: number; effectiveFrom: string; existingSalonsKeepPrevious: boolean; note: string | null; publishedAt: string; inEffect: boolean; rows: { feature: string; unit: AiPriceUnit; priceCents: number }[] }
export interface AiPriceOverrideView { tenantId: string; salon: string | null; feature: string; unit: AiPriceUnit; priceCents: number | null; effectiveFrom: string; reason: string; createdAt: string }
export interface AiPriceTableResponse { versions: AiPriceVersionView[]; overrides: AiPriceOverrideView[]; empty: boolean; ceilingCents: number }
