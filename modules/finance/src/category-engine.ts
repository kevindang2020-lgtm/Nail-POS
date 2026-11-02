// category-engine.ts — which owner category an expense belongs in, and why (mandate §39–43, §164–175).
//
// Deterministic first, AI second, Other last — in EXACTLY this priority (§42):
//   1. owner explicit rule      the owner said "always put Verizon Business under Utilities / Bills" (§174)
//   2. tenant vendor rule       learned from this salon's own repeated corrections (§41) — never another salon's
//   3. vendor + line-item rule  "ABC Nail Supply" + a line mentioning "chair" → Equipment
//   4. system rule              Home Depot → Repairs (Equipment when the lines are furniture/equipment), electric → Utilities …
//   5. AI recommendation        only a key from this salon's own category list is accepted (§39)
//   6. Other                    the safe fallback (§172)
// A person's own pick on the expense beats all of it (source 'owner'). This module SUGGESTS; approval decides (§164).
// Every answer carries its reason (§173) so the owner can see why.
import { DEFAULT_CATEGORY_KEYS, FALLBACK_CATEGORY } from './expense-categories';
import { normalizeVendorName } from './vendor-normalize';

export type CategorySource = 'owner' | 'owner_rule' | 'vendor_rule' | 'system_rule' | 'ai' | 'fallback';
export interface CategoryRule { vendorNorm: string; keyword: string | null; categoryKey: string; kind: 'owner_lock' | 'learned'; active?: boolean }
export interface CategoryInput {
  vendorRaw: string | null;
  lineDescriptions?: readonly string[];
  /** the salon's rules (owner locks + learned), tenant-scoped by the caller */
  rules?: readonly CategoryRule[];
  /** what the AI suggested, if it was asked */
  ai?: { key: string; confidence: number; reason?: string } | null;
  /** every key this salon may use: the ten defaults + its active custom ones */
  validKeys?: ReadonlySet<string>;
}
export interface CategoryRecommendation { key: string; source: CategorySource; reason: string; confidence: number }

// §165–171: the vendor words a salon's receipts carry. Matched on the NORMALIZED vendor name, whole words only.
const SYSTEM_VENDOR_RULES: ReadonlyArray<{ words: RegExp; key: string; reason: string }> = [
  { words: /\b(landlord|realty|properties|property management|leasing|rent)\b/, key: 'rent', reason: 'Vendor looks like a landlord or property manager.' },
  { words: /\b(nail supply|beauty supply|salon supply|sally beauty|cosmoprof|opi|cnd|dnd|kiara sky|nail (?:co|company|distributor|wholesale)|pedicure supply)\b/, key: 'supplies', reason: 'Vendor is a nail / beauty supply distributor.' },
  { words: /\b(pse ?(?:and )?g|pseg|jcp ?(?:and )?l|atlantic city electric|con ?ed|duke energy|electric|power|energy|gas company|south jersey gas|nj natural gas|water|sewer|american water|comcast|xfinity|verizon|at ?(?:and )?t|t mobile|spectrum|optimum|internet|telephone)\b/, key: 'utilities', reason: 'Vendor is an electric, gas, water, internet or phone company.' },
  { words: /\b(google workspace|g suite|microsoft|office 365|adobe|dropbox|zoom|quickbooks|intuit|godaddy|squarespace|wix|shopify|canva|apple com bill|icloud|slack|vagaro|mindbody|booksy|fresha|aws|amazon web services|hosting|domain)\b/, key: 'software', reason: 'Vendor sells software, hosting or a subscription.' },
  { words: /\b(meta|facebook|instagram|google ads|yelp|vistaprint|groupon|nextdoor|tiktok ads|mailchimp|constant contact|print|flyer|signs?)\b/, key: 'marketing', reason: 'Vendor sells advertising or printed promotion.' },
  { words: /\b(insurance|state farm|allstate|geico|progressive|hiscox|the hartford|hartford|travelers|nationwide|liberty mutual|next insurance|chubb|farmers)\b/, key: 'insurance', reason: 'Vendor is an insurance carrier.' },
  { words: /\b(adp|gusto|paychex|paycom|payroll)\b/, key: 'payroll', reason: 'Vendor is a payroll provider.' },
  { words: /\b(home depot|lowes|lowe s|menards|ace hardware|true value|hardware|plumbing|plumber|hvac|electrician|handyman|locksmith|repair)\b/, key: 'repairs', reason: 'Vendor is a hardware store or repair service.' },
  { words: /\b(pedicure chair|salon furniture|belava|j and a|continuum|whale spa|equipment)\b/, key: 'equipment', reason: 'Vendor sells salon furniture or equipment.' },
];
// §163–165: the line items decide between Repairs and Equipment, and spot supplies on a general store's receipt
const EQUIPMENT_LINE = /\b(chair|table|station|lamp|uv lamp|led lamp|dryer|sterilizer|autoclave|drill|e ?file|vacuum|furniture|cabinet|tv|television|computer|printer|tablet|ipad)\b/i;
const SUPPLY_LINE = /\b(polish|gel|acetone|gloves?|files?|buffers?|liners?|cotton|towels?|wipes|sanitizer|disinfectant|barbicide|tips|acrylic|powder|monomer|top coat|base coat)\b/i;
const REPAIR_LINE = /\b(filter|pipe|faucet|valve|fitting|paint|drywall|caulk|bulb|outlet|switch|lock|hinge|repair|fix|replacement part)\b/i;

function lineHint(lines: readonly string[]): { key: string; reason: string } | null {
  const text = lines.join(' | ');
  if (!text.trim()) return null;
  const eq = EQUIPMENT_LINE.test(text), sup = SUPPLY_LINE.test(text), rep = REPAIR_LINE.test(text);
  if (eq && !sup) return { key: 'equipment', reason: 'Items appear to be furniture or equipment.' };
  if (sup && !eq) return { key: 'supplies', reason: 'Items appear to be salon consumables.' };
  if (rep && !eq) return { key: 'repairs', reason: 'Items appear to be building repair materials.' };
  return null;
}

export function recommendCategory(input: CategoryInput): CategoryRecommendation {
  const valid = input.validKeys ?? DEFAULT_CATEGORY_KEYS;
  const ok = (k: string | null | undefined): k is string => !!k && valid.has(k);
  const vendorNorm = normalizeVendorName(input.vendorRaw);
  const lines = (input.lineDescriptions ?? []).map((l) => String(l ?? '')).filter(Boolean);
  const rules = (input.rules ?? []).filter((r) => r.active !== false && r.vendorNorm === vendorNorm && ok(r.categoryKey));

  if (vendorNorm) {
    // 1. owner explicit lock (vendor-wide)
    const lock = rules.find((r) => r.kind === 'owner_lock' && !r.keyword);
    if (lock) return { key: lock.categoryKey, source: 'owner_rule', reason: `You set ${input.vendorRaw} to always use this category.`, confidence: 1 };
    // 2. tenant vendor rule (learned, vendor-wide)
    const learned = rules.find((r) => r.kind === 'learned' && !r.keyword);
    if (learned) return { key: learned.categoryKey, source: 'vendor_rule', reason: `You filed ${input.vendorRaw} under this category before.`, confidence: 0.97 };
    // 3. vendor + line-item rule
    const kw = rules.find((r) => r.keyword && lines.some((l) => l.toLowerCase().includes(r.keyword!.toLowerCase())));
    if (kw) return { key: kw.categoryKey, source: kw.kind === 'owner_lock' ? 'owner_rule' : 'vendor_rule', reason: `${input.vendorRaw} with "${kw.keyword}" goes here by your rule.`, confidence: 0.96 };
    // 4. system rule: vendor words, refined by the line items (Home Depot: repairs, or equipment when it was a chair)
    const sys = SYSTEM_VENDOR_RULES.find((r) => r.words.test(vendorNorm));
    if (sys && ok(sys.key)) {
      const hint = lineHint(lines);
      if (hint && ok(hint.key) && hint.key !== sys.key && (sys.key === 'repairs' || sys.key === 'supplies' || sys.key === 'equipment'))
        return { key: hint.key, source: 'system_rule', reason: `${sys.reason} ${hint.reason}`, confidence: 0.85 };
      return { key: sys.key, source: 'system_rule', reason: sys.reason, confidence: 0.9 };
    }
  }
  // 4b. no vendor rule, but the items alone are clear
  const hint = lineHint(lines);
  if (hint && ok(hint.key)) return { key: hint.key, source: 'system_rule', reason: hint.reason, confidence: 0.75 };
  // 5. AI — only a key this salon actually has
  if (input.ai && ok(input.ai.key) && input.ai.confidence > 0) return { key: input.ai.key, source: 'ai', reason: input.ai.reason || 'Suggested by AI from the receipt.', confidence: Math.min(0.95, input.ai.confidence) };
  // 6. Other
  return { key: FALLBACK_CATEGORY, source: 'fallback', reason: 'No rule matched — filed under Other for you to check.', confidence: 0 };
}

/**
 * §41: when the owner moves the SAME vendor from the suggestion to another category, the correction is remembered as
 * a tenant vendor rule — but only once it is a pattern (two corrections to the same category), never from one click,
 * and never over an owner lock. Returns the rule to save, or null.
 */
export function learnFromCorrection(args: { vendorRaw: string | null; from: string; to: string; priorCorrectionsToSameKey: number; existing?: readonly CategoryRule[] }): CategoryRule | null {
  const vendorNorm = normalizeVendorName(args.vendorRaw);
  if (!vendorNorm || args.from === args.to) return null;
  if ((args.existing ?? []).some((r) => r.vendorNorm === vendorNorm && !r.keyword && r.kind === 'owner_lock' && r.active !== false)) return null;
  if (args.priorCorrectionsToSameKey + 1 < 2) return null;
  return { vendorNorm, keyword: null, categoryKey: args.to, kind: 'learned', active: true };
}
