// retention-pricing.ts — Customer Retention, Four-Module Completion Guide (Oct 30 2026) CR-03: the salon's SMS cost
// ESTIMATE before a win-back send. Audit of what existed: sms_verification_packages (monthly plans + an overage unit price
// for OTP verifications), platform_settings 'sms.marketing_segment_price_cents' (ONE platform-wide number: no currency,
// no carrier fee, no tax, no effective date, not per salon) — neither is a tenant price, so tenant_sms_pricing (724) was
// added: append-only, effective-dated, per salon, set through the retention settings (pos.settings.edit) and audited.
// No row in force → "Price unknown — cannot estimate" (never $0). An estimate is not an invoice: the provider's segment
// count and the bill decide; included plan allowances are not netted here.
import { sql, type Kysely } from 'kysely';
import { taxCents } from '@aipowersalon/money';
import { RetentionError, isUuid, type RetentionContext } from './retention.repository';

export interface SmsPricing { pricingId: string; currency: string; retailPricePerSegment: string; carrierFeePerSegment: string | null; taxRatePercent: string | null; effectiveFrom: string; note: string | null; setByRole: string | null; createdAt: string }
export interface SmsEstimate {
  status: 'estimated' | 'price_unknown';
  recipients: number; segmentsPerMessage: number; encoding: string; totalSegments: number;
  currency: string | null; unitPrice: string | null; pricingEffectiveFrom: string | null;
  subtotalCents: number | null; carrierFeesCents: number | null; carrierFeesKnown: boolean; taxCents: number | null; taxKnown: boolean; totalCents: number | null;
  /** true when a fee or the tax is unknown — the total is then a lower bound */
  totalIsLowerBound: boolean;
  uncertainty: string[];
}

const MICRO = 1_000_000;
/** '0.0350' → 35000 micro-units (exact decimal → integer; no float drift) */
export function toMicros(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const m = /^(\d+)(?:\.(\d{0,6})\d*)?$/.exec(String(v).trim()); if (!m) return null;
  return Number(m[1]) * MICRO + Number((m[2] ?? '').padEnd(6, '0'));
}
const centsOfMicros = (micros: number) => Math.round(micros / 10_000);   // 1 cent = 10 000 micro-units (half up for ≥ 0)

/** The estimate, pure: recipients × segments × unit price; carrier fee and tax only when known (else flagged). */
export function estimateSms(input: { recipients: number; segmentsPerMessage: number; encoding: string }, p: SmsPricing | null): SmsEstimate {
  const totalSegments = Math.max(0, input.recipients) * Math.max(0, input.segmentsPerMessage);
  const base = { recipients: input.recipients, segmentsPerMessage: input.segmentsPerMessage, encoding: input.encoding, totalSegments };
  if (!p) return { ...base, status: 'price_unknown', currency: null, unitPrice: null, pricingEffectiveFrom: null, subtotalCents: null, carrierFeesCents: null, carrierFeesKnown: false,
    taxCents: null, taxKnown: false, totalCents: null, totalIsLowerBound: false, uncertainty: ['Price unknown — cannot estimate. No SMS price is configured for this salon.'] };
  const unit = toMicros(p.retailPricePerSegment) ?? 0; const fee = toMicros(p.carrierFeePerSegment);
  const subtotal = centsOfMicros(totalSegments * unit);
  const fees = fee == null ? null : centsOfMicros(totalSegments * fee);
  const taxRate = p.taxRatePercent == null ? null : Number(p.taxRatePercent);
  const tax = taxRate == null ? null : taxCents(subtotal + (fees ?? 0), taxRate);   // the ONE tax authority (packages/money)
  const unc = ['Estimate only — the carrier\'s segment count and your invoice decide the final charge.', 'Included plan allowances are not subtracted.'];
  if (fees == null) unc.push('Carrier fees are unknown and not included.');
  if (tax == null) unc.push('Tax is unknown and not included.');
  if (input.encoding === 'UCS-2') unc.push('This text uses special characters (UCS-2): each segment holds 70 characters, not 160.');
  return { ...base, status: 'estimated', currency: p.currency, unitPrice: p.retailPricePerSegment, pricingEffectiveFrom: p.effectiveFrom,
    subtotalCents: subtotal, carrierFeesCents: fees, carrierFeesKnown: fees != null, taxCents: tax, taxKnown: tax != null,
    totalCents: subtotal + (fees ?? 0) + (tax ?? 0), totalIsLowerBound: fees == null || tax == null, uncertainty: unc };
}

const rowOut = (r: any): SmsPricing => ({ pricingId: String(r.id), currency: String(r.currency), retailPricePerSegment: String(r.retail_price_per_segment),
  carrierFeePerSegment: r.carrier_fee_per_segment == null ? null : String(r.carrier_fee_per_segment), taxRatePercent: r.tax_rate_percent == null ? null : String(r.tax_rate_percent),
  effectiveFrom: new Date(r.effective_from).toISOString(), note: r.note ?? null, setByRole: r.set_by_role ?? null, createdAt: new Date(r.created_at).toISOString() });

/** the columns rowOut reads — never the whole row (set_by_user_id stays server-side) */
const P_COLS = sql`p.id, p.currency, p.retail_price_per_segment, p.carrier_fee_per_segment, p.tax_rate_percent, p.effective_from, p.note, p.set_by_role, p.created_at`;

export class RetentionPricingRepository {
  constructor(readonly db: Kysely<any>) {}
  /** the price in force at `at` (default now): the latest effective_from ≤ at, newest entry wins */
  async pricingAt(ctx: RetentionContext, at: Date = new Date()): Promise<SmsPricing | null> {
    const r = (await sql<any>`select ${P_COLS} from tenant_sms_pricing p where p.tenant_id = ${ctx.tenantId} and p.effective_from <= ${at}
      order by p.effective_from desc, p.created_at desc limit 1`.execute(this.db)).rows[0];
    return r ? rowOut(r) : null;
  }
  async overview(ctx: RetentionContext) {
    const hist = (await sql<any>`select ${P_COLS} from tenant_sms_pricing p where p.tenant_id = ${ctx.tenantId} order by p.effective_from desc, p.created_at desc limit 10`.execute(this.db)).rows.map(rowOut);
    const current = await this.pricingAt(ctx);
    const upcoming = hist.filter((h) => Date.parse(h.effectiveFrom) > Date.now());
    return { current, upcoming, history: hist };
  }
  /** append a new effective-dated price (never edits one); the audit runs in the SAME transaction (fail-closed) */
  async setPricing(ctx: RetentionContext, b: { retailPricePerSegment: unknown; carrierFeePerSegment?: unknown; taxRatePercent?: unknown; currency?: unknown; effectiveFrom?: unknown; note?: unknown },
    audit: (trx: Kysely<any>, before: SmsPricing | null, after: SmsPricing) => Promise<void>): Promise<SmsPricing> {
    const dec = (v: unknown, max: number, field: string, required: boolean) => {
      if (v == null || v === '') { if (required) throw new RetentionError('Enter the price per segment.', 'SMS_PRICING_INVALID', 400, { field }); return null; }
      const s = String(v).trim(); const m = toMicros(s);
      if (m == null || m > max * MICRO || !/^\d+(\.\d{1,5})?$/.test(s)) throw new RetentionError('Enter a number with at most 5 decimals.', 'SMS_PRICING_INVALID', 400, { field });
      return s;
    };
    const retail = dec(b.retailPricePerSegment, 10, 'retailPricePerSegment', true)!;
    const fee = dec(b.carrierFeePerSegment, 10, 'carrierFeePerSegment', false);
    const tax = dec(b.taxRatePercent, 50, 'taxRatePercent', false);
    const currency = b.currency == null || b.currency === '' ? 'USD' : String(b.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new RetentionError('Use a three-letter currency code.', 'SMS_PRICING_INVALID', 400, { field: 'currency' });
    let eff: Date | null = null;
    if (b.effectiveFrom != null && b.effectiveFrom !== '') { const t = Date.parse(String(b.effectiveFrom)); if (Number.isNaN(t)) throw new RetentionError('Choose a valid start date.', 'SMS_PRICING_INVALID', 400, { field: 'effectiveFrom' }); eff = new Date(t); }
    const note = b.note == null ? null : String(b.note).slice(0, 200);
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'sms-pricing:' + ctx.tenantId}))`.execute(trx);
      const before = (await sql<any>`select ${P_COLS} from tenant_sms_pricing p where p.tenant_id = ${ctx.tenantId} and p.effective_from <= now() order by p.effective_from desc, p.created_at desc limit 1`.execute(trx)).rows[0];
      const r = (await sql<any>`insert into tenant_sms_pricing (tenant_id, currency, retail_price_per_segment, carrier_fee_per_segment, tax_rate_percent, effective_from, note, set_by_user_id, set_by_role)
        values (${ctx.tenantId}, ${currency}, ${retail}::numeric, ${fee}::numeric, ${tax}::numeric, coalesce(${eff}::timestamptz, now()), ${note}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${ctx.role ?? null})
        returning id, currency, retail_price_per_segment, carrier_fee_per_segment, tax_rate_percent, effective_from, note, set_by_role, created_at`.execute(trx)).rows[0];
      const after = rowOut(r);
      await audit(trx, before ? rowOut(before) : null, after);
      return after;
    });
  }
}
