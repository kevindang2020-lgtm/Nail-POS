// ai-catalog.ts — the canonical catalog of the 15 AI assistant packages. Single source of truth for codes, names,
// pricing defaults, usage units, and the POS area each one plugs into. Super Admin price/limit/enable overrides live in
// the DB (tenant_ai_* / usage_limits); this file defines the package set itself so every layer agrees on the 15 codes.
// Money is integer cents. PURE — no imports, fully testable.

export type AiUsageUnit = 'calls' | 'messages' | 'minutes' | 'scans' | 'generations' | 'runs';

export interface AiPackageDef {
  code: string;
  name: string;
  description: string;
  category: 'front_desk' | 'operations' | 'growth' | 'finance' | 'insights';
  posArea: string;            // where it plugs into the POS
  monthlyPriceCents: number;
  includedUsageLimit: number; // included units per billing period
  usageUnit: AiUsageUnit;
  overagePriceCents: number;  // per unit beyond the included limit
  trialDays: number;
  sortOrder: number;
}

export const AI_PACKAGES: readonly AiPackageDef[] = [
  { code: 'ai_booking_assistant',           name: 'AI Booking Assistant',          description: 'Turns customer messages into booked appointments; auto-fills service, tech, and time and flags conflicts.', category: 'front_desk', posArea: 'Booking / appointment creation', monthlyPriceCents: 4900,  includedUsageLimit: 1000, usageUnit: 'messages',    overagePriceCents: 3,   trialDays: 14, sortOrder: 1 },
  { code: 'ai_phone_call_assistant',        name: 'AI Phone Call Assistant',       description: 'AI receptionist that answers inbound calls, books appointments, answers salon questions, and hands off to a human.', category: 'front_desk', posArea: 'Phone / inbound call workflow', monthlyPriceCents: 9900,  includedUsageLimit: 500,  usageUnit: 'minutes',     overagePriceCents: 12,  trialDays: 14, sortOrder: 2 },
  { code: 'ai_queue_technician_assignment', name: 'AI Queue + Technician Assignment', description: 'Recommends the best technician, balances the queue, and assigns walk-ins to cut wait time.', category: 'operations', posArea: 'Queue / Check-In / Tech Queue', monthlyPriceCents: 3900,  includedUsageLimit: 5000, usageUnit: 'calls',       overagePriceCents: 1,   trialDays: 14, sortOrder: 3 },
  { code: 'ai_scheduling_optimizer',        name: 'AI Scheduling Optimizer',       description: 'Optimizes the day schedule, finds gaps, prevents overbooking, and improves tech utilization.', category: 'operations', posArea: 'Booking calendar / staff schedule', monthlyPriceCents: 3900,  includedUsageLimit: 1000, usageUnit: 'runs',        overagePriceCents: 5,   trialDays: 14, sortOrder: 4 },
  { code: 'ai_business_assistant',          name: 'AI Business Assistant',         description: 'Explains sales, summarizes performance, answers owner questions, and suggests improvements.', category: 'insights',   posArea: 'Owner dashboard / Reports', monthlyPriceCents: 5900,  includedUsageLimit: 1000, usageUnit: 'messages',    overagePriceCents: 4,   trialDays: 14, sortOrder: 5 },
  { code: 'ai_marketing_assistant',         name: 'AI Marketing Assistant',        description: 'Creates campaigns, writes SMS/email, segments customers, and suggests promotions.', category: 'growth',     posArea: 'Marketing / campaigns', monthlyPriceCents: 5900,  includedUsageLimit: 500,  usageUnit: 'generations', overagePriceCents: 8,   trialDays: 14, sortOrder: 6 },
  { code: 'ai_customer_profile_assistant',  name: 'AI Customer Profile Assistant', description: 'Summarizes preferences, recommends services, detects VIP/churn risk, and drafts customer notes.', category: 'front_desk', posArea: 'Customer profile / history', monthlyPriceCents: 3900,  includedUsageLimit: 2000, usageUnit: 'messages',    overagePriceCents: 3,   trialDays: 14, sortOrder: 7 },
  { code: 'ai_checkout_upsell_assistant',   name: 'AI Checkout + Upsell Assistant', description: 'Suggests upsells and add-ons, detects missed services, and proposes the next appointment.', category: 'growth',     posArea: 'Checkout / Service Done / Receipt', monthlyPriceCents: 4900,  includedUsageLimit: 3000, usageUnit: 'calls',       overagePriceCents: 2,   trialDays: 14, sortOrder: 8 },
  { code: 'ai_fraud_money_protection',      name: 'AI Fraud / Money Protection',   description: 'Flags suspicious refunds, discount abuse, void patterns, and payment mismatches.', category: 'finance',    posArea: 'Checkout / cash drawer / reports', monthlyPriceCents: 6900,  includedUsageLimit: 10000, usageUnit: 'calls',      overagePriceCents: 1,   trialDays: 14, sortOrder: 9 },
  { code: 'ai_inventory_assistant',         name: 'AI Inventory Assistant',        description: 'Predicts low stock, suggests reorders, detects abnormal usage, and optimizes supply costs.', category: 'operations', posArea: 'Inventory / purchasing', monthlyPriceCents: 3900,  includedUsageLimit: 1000, usageUnit: 'runs',        overagePriceCents: 5,   trialDays: 14, sortOrder: 10 },
  { code: 'ai_reception_copilot',           name: 'AI Reception Copilot',          description: 'Guides front-desk staff, answers customer questions, and summarizes the queue and appointments.', category: 'front_desk', posArea: 'Reception POS / Check-In', monthlyPriceCents: 5900,  includedUsageLimit: 2000, usageUnit: 'messages',    overagePriceCents: 4,   trialDays: 14, sortOrder: 11 },
  { code: 'ai_review_reputation_assistant', name: 'AI Review / Reputation Assistant', description: 'Drafts review replies, detects bad reviews, suggests recovery messages, and requests reviews from happy customers.', category: 'growth', posArea: 'Reviews / feedback', monthlyPriceCents: 3900,  includedUsageLimit: 1000, usageUnit: 'generations', overagePriceCents: 6,   trialDays: 14, sortOrder: 12 },
  { code: 'ai_voice_transcription',         name: 'AI Voice Transcription',        description: 'Transcribes calls and voice notes, extracts appointment details, and saves notes to the customer profile.', category: 'operations', posArea: 'Calls / voice notes', monthlyPriceCents: 2900,  includedUsageLimit: 1000, usageUnit: 'minutes',     overagePriceCents: 10,  trialDays: 14, sortOrder: 13 },
  { code: 'ai_ocr_receipt_scanner',         name: 'AI OCR Receipt Scanner',        description: 'Scans receipt images, extracts vendor/items/amounts, saves the expense, and updates inventory.', category: 'finance',    posArea: 'Inventory / expenses / receipts', monthlyPriceCents: 2900,  includedUsageLimit: 500, usageUnit: 'scans',        overagePriceCents: 8,   trialDays: 14, sortOrder: 14 },
  { code: 'ai_analytics_forecasting',       name: 'AI Analytics / Forecasting',    description: 'Forecasts sales, appointments, staffing needs, and product usage, and surfaces growth trends.', category: 'insights',   posArea: 'Reports / dashboards', monthlyPriceCents: 7900,  includedUsageLimit: 500,  usageUnit: 'runs',        overagePriceCents: 15,  trialDays: 14, sortOrder: 15 },
];

export const AI_PACKAGE_CODES = AI_PACKAGES.map((p) => p.code);
const BY_CODE = new Map(AI_PACKAGES.map((p) => [p.code, p]));
export function getAiPackage(code: string): AiPackageDef | undefined { return BY_CODE.get(code); }
export function isAiPackageCode(code: string): boolean { return BY_CODE.has(code); }
