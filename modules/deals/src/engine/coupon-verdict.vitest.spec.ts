// coupon-verdict.vitest — the checker only TRANSLATES the engine's reasons: no reasons ⇒ ELIGIBLE, anything unknown ⇒
// NOT_AVAILABLE (never silently eligible), the record's own status speaks first for the engine's generic not_active.
import { describe, it, expect } from 'vitest';
import { couponVerdict, configReasons, VERDICT_ACTION, VERDICT_CODES } from './coupon-verdict';

describe('couponVerdict', () => {
  it('no reasons → ELIGIBLE', () => { expect(couponVerdict('active', [])).toMatchObject({ verdict: 'ELIGIBLE', eligible: true, reasons: [] }); });
  it('maps the engine codes to the guide codes, first reason leads', () => {
    const v = couponVerdict('active', [{ code: 'min_spend', message: 'Spend at least $50.00.', params: { cents: 5000 } }, { code: 'wrong_branch', message: 'x' }]);
    expect(v.verdict).toBe('MIN_SPEND'); expect(v.eligible).toBe(false); expect(v.reasons.map((r) => r.code)).toEqual(['MIN_SPEND', 'WRONG_BRANCH']);
    expect(v.reasons[0]).toMatchObject({ engineCode: 'min_spend', params: { cents: 5000 } });
  });
  it.each([
    ['not_started', 'NOT_YET_ACTIVE'], ['ended', 'EXPIRED'], ['no_eligible_service', 'INELIGIBLE_SERVICE'], ['sold_out', 'LIMIT_REACHED'], ['budget_exhausted', 'LIMIT_REACHED'],
    ['per_customer_limit', 'ALREADY_USED'], ['code_used', 'ALREADY_USED'], ['customer_required', 'NEEDS_CUSTOMER'], ['code_required', 'NEEDS_CODE'], ['members_only', 'CUSTOMER_INELIGIBLE'],
    ['engine_off', 'PAUSED'], ['not_best', 'NOT_COMBINABLE'], ['config_missing', 'CONFIG_MISSING'], ['something_new', 'NOT_AVAILABLE'],
  ])('%s → %s', (code, want) => { expect(couponVerdict('active', [{ code, message: '' }]).verdict).toBe(want); });
  it('not_active uses the record status: draft → REQUIRES_APPROVAL, paused → PAUSED, archived → NOT_AVAILABLE', () => {
    expect(couponVerdict('draft', [{ code: 'not_active', message: '', params: { status: 'draft' } }]).verdict).toBe('REQUIRES_APPROVAL');
    expect(couponVerdict('paused', [{ code: 'not_active', message: '', params: { status: 'paused' } }]).verdict).toBe('PAUSED');
    expect(couponVerdict('archived', [{ code: 'not_active', message: '' }]).verdict).toBe('NOT_AVAILABLE');
  });
  it('configReasons: no value or no code is CONFIG_MISSING', () => {
    expect(configReasons({ status: 'active', discountType: 'percent', discountPercent: 0 }).map((r) => r.code)).toEqual(['config_missing']);
    expect(configReasons({ status: 'active', discountType: 'percent', discountPercent: 20, requiresCode: true, codes: 0 }).map((r) => r.code)).toEqual(['config_missing']);
    expect(configReasons({ status: 'active', discountType: 'fixed', discountCents: 500 })).toEqual([]);
  });
  it('every code has action guidance', () => { for (const c of VERDICT_CODES) expect(VERDICT_ACTION[c].length).toBeGreaterThan(5); });
});
