// ai-module-registry.ts — the canonical registry of the 15 AI PowerSalon AI modules as defined by the product
// spec (ai_booking, ai_phone, …, ai_scheduling_optimizer). This is ADDITIVE and non-breaking: the billable
// package catalog (ai-catalog.ts) keeps its established DB-backing codes (e.g. ai_booking_assistant,
// ai_fraud_money_protection) for backwards compatibility with tenant_ai_* / usage records; this file simply
// gives every layer one authoritative map between the spec's canonical codes and those catalog codes + the
// backend module that implements each capability. PURE — the only import is the catalog code list, so the
// alias mapping is self-verified against the real catalog by the accompanying test.
import { AI_PACKAGE_CODES } from './ai-catalog';

export type CanonicalAiModuleCode =
  | 'ai_booking' | 'ai_phone' | 'ai_business' | 'ai_marketing' | 'ai_customer_profile'
  | 'ai_checkout_upsell' | 'ai_money_protection' | 'ai_inventory' | 'ai_review_reputation'
  | 'ai_voice_transcription' | 'ai_ocr_receipt' | 'ai_analytics_forecasting'
  | 'ai_deposit_reconciliation' | 'ai_queue_assignment' | 'ai_scheduling_optimizer';

export interface CanonicalAiModule {
  code: CanonicalAiModuleCode;
  name: string;
  /** The billable package code in ai-catalog.ts, or null when the capability ships as a non-package module. */
  catalogCode: string | null;
  /** The backend module directory under apps/api/src that implements the capability. */
  backendModule: string;
  /** Where it plugs into the product. */
  posArea: string;
}

export const CANONICAL_AI_MODULES: readonly CanonicalAiModule[] = [
  { code: 'ai_booking',                name: 'AI Booking',                catalogCode: 'ai_booking_assistant',           backendModule: 'ai-booking',                posArea: 'Booking / appointment creation' },
  { code: 'ai_phone',                  name: 'AI Phone',                  catalogCode: 'ai_phone_call_assistant',        backendModule: 'voice-booking',             posArea: 'Phone / inbound call workflow' },
  { code: 'ai_business',               name: 'AI Business',               catalogCode: 'ai_business_assistant',          backendModule: 'ai-business',               posArea: 'Owner dashboard / reports' },
  { code: 'ai_marketing',             name: 'AI Marketing',              catalogCode: 'ai_marketing_assistant',         backendModule: 'ai-marketing',              posArea: 'Marketing / campaigns' },
  { code: 'ai_customer_profile',      name: 'AI Customer Profile',       catalogCode: 'ai_customer_profile_assistant',  backendModule: 'ai-customer-profile',       posArea: 'Customer profile / history' },
  { code: 'ai_checkout_upsell',       name: 'AI Checkout Upsell',        catalogCode: 'ai_checkout_upsell_assistant',   backendModule: 'ai-checkout-upsell',        posArea: 'Checkout / receipt' },
  { code: 'ai_money_protection',      name: 'AI Money Protection',       catalogCode: 'ai_fraud_money_protection',      backendModule: 'ai-money-protection',       posArea: 'Checkout / cash drawer / reports' },
  { code: 'ai_inventory',             name: 'AI Inventory',              catalogCode: 'ai_inventory_assistant',         backendModule: 'ai-inventory',              posArea: 'Inventory / purchasing' },
  { code: 'ai_review_reputation',     name: 'AI Review / Reputation',    catalogCode: 'ai_review_reputation_assistant', backendModule: 'ai-review-reputation',      posArea: 'Reviews / feedback' },
  { code: 'ai_voice_transcription',   name: 'AI Voice Transcription',    catalogCode: 'ai_voice_transcription',         backendModule: 'ai-voice-transcription',    posArea: 'Calls / voice notes' },
  { code: 'ai_ocr_receipt',           name: 'AI OCR Receipt',            catalogCode: 'ai_ocr_receipt_scanner',         backendModule: 'ai-ocr-receipt',            posArea: 'Inventory / expenses / receipts' },
  { code: 'ai_analytics_forecasting', name: 'AI Analytics / Forecasting', catalogCode: 'ai_analytics_forecasting',       backendModule: 'ai-analytics-forecasting',  posArea: 'Reports / dashboards' },
  // Deposit reconciliation ships as a finance module (gateway-integrated for explanations, usage-tracked) but
  // is not a separately billable package in the catalog — hence catalogCode is null.
  { code: 'ai_deposit_reconciliation', name: 'AI Deposit Reconciliation', catalogCode: null,                            backendModule: 'deposit-reconciliation',    posArea: 'Finance / settlements' },
  { code: 'ai_queue_assignment',      name: 'AI Queue Assignment',       catalogCode: 'ai_queue_technician_assignment', backendModule: 'ai-queue-assignment',       posArea: 'Queue / check-in / tech queue' },
  { code: 'ai_scheduling_optimizer',  name: 'AI Scheduling Optimizer',   catalogCode: 'ai_scheduling_optimizer',        backendModule: 'ai-scheduling-optimizer',   posArea: 'Booking calendar / staff schedule' },
];

export const CANONICAL_AI_MODULE_CODES = CANONICAL_AI_MODULES.map((m) => m.code);

const byCanonical = new Map(CANONICAL_AI_MODULES.map((m) => [m.code, m]));
const byCatalog = new Map(CANONICAL_AI_MODULES.filter((m) => m.catalogCode).map((m) => [m.catalogCode as string, m]));

/** Canonical spec code → billable catalog package code (null when the capability is not a billable package). */
export function canonicalToCatalog(code: CanonicalAiModuleCode): string | null {
  return byCanonical.get(code)?.catalogCode ?? null;
}
/** Billable catalog package code → canonical spec code (undefined for packages outside the canonical 15, e.g. ai_reception_copilot). */
export function catalogToCanonical(catalogCode: string): CanonicalAiModuleCode | undefined {
  return byCatalog.get(catalogCode)?.code;
}
/** Catalog package codes that are NOT part of the canonical 15 (e.g. ai_reception_copilot). */
export function extraCatalogPackages(): string[] {
  const mapped = new Set(CANONICAL_AI_MODULES.map((m) => m.catalogCode).filter(Boolean) as string[]);
  return AI_PACKAGE_CODES.filter((c) => !mapped.has(c));
}
