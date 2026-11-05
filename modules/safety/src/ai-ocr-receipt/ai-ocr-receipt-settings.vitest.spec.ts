// ai-ocr-receipt-settings.vitest.spec.ts — tri-state settings with hard clamps. PII masking and human review can never
// be disabled by tenant/branch config; "disabled wins" downward; numeric fields are clamped to safe ranges.
import { describe, it, expect } from 'vitest';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, maskFieldForStorage, redactPageText, type SettingsRow } from './ai-ocr-receipt-settings';

describe('settings resolution', () => {
  it('applies defaults and honors disable downward', () => {
    const def = resolveSettings({ platform: PLATFORM_DEFAULTS });
    expect(def.enabled).toBe(true);
    expect(def.config.humanReviewRequired).toBe(true);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: false, config: null } }).enabled).toBe(false);
    expect(resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: true, config: null }, branch: { level: 'branch', branch_id: 'b1', enabled: false, config: null } }).enabled).toBe(false);
  });
  it('merges + clamps and CANNOT weaken safety invariants', () => {
    const merged = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: true, config: { highAmountCents: 9999, approvalRules: { requireApprovalAboveCents: 1000, dualApprovalAboveCents: 500000, restrictedCategories: ['gift_cards'] } } } });
    expect(merged.config.highAmountCents).toBe(9999);
    expect(merged.config.approvalRules.restrictedCategories).toContain('gift_cards');
    const evil = resolveSettings({ platform: PLATFORM_DEFAULTS, tenant: { level: 'tenant', branch_id: null, enabled: true, config: { piiMasking: false as any, humanReviewRequired: false as any, retentionDays: 1 } } });
    expect(evil.config.piiMasking).toBe(true);
    expect(evil.config.humanReviewRequired).toBe(true);
    expect(evil.config.retentionDays).toBe(30);
  });
  it('splits rows into tenant + branch layers', () => {
    const rows: SettingsRow[] = [{ level: 'tenant', branch_id: null, enabled: true, config: null }, { level: 'branch', branch_id: 'b1', enabled: false, config: null }];
    expect(rowsToLayers(rows, { branchId: 'b1' }).branch?.branch_id).toBe('b1');
    expect(rowsToLayers(rows, { branchId: 'other' }).branch).toBeNull();
  });
});

describe('PII storage helpers', () => {
  it('masks sensitive keys and redacts embedded numbers', () => {
    expect(maskFieldForStorage('card_number', '4111 1111 1111 1234')).toBe('••••1234');
    expect(maskFieldForStorage('notes', 'ref 4111111111111234 paid')).not.toContain('4111111111111234');
    expect(redactPageText('acct 4111111111111234')).not.toContain('4111111111111234');
  });
});
