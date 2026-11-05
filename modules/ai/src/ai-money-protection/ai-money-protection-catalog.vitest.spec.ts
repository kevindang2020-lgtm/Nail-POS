// ai-money-protection-catalog.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { RULE_CATALOG, getRuleCatalog } from './ai-money-protection-catalog';
import { MoneyProtectionService } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import { InMemoryEntitlement } from './ai-money-protection-entitlement';
import { moneyProtectionFlags } from './ai-money-protection-flags';
import type { MoneyProtectionContext } from './ai-money-protection.dto';

const ctx = (perms: string[]): MoneyProtectionContext => ({ tenantId: 'A', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });

describe('RULE_CATALOG', () => {
  it('every rule has complete descriptor fields and requires human review', () => {
    for (const r of RULE_CATALOG) {
      expect(r.id).toBeTruthy();
      expect(r.alertType).toBeTruthy();
      expect(r.name).toBeTruthy();
      expect(['duplicate_charge', 'refund', 'void', 'discount', 'tip', 'failed_payment', 'reconciliation', 'employee', 'integrity']).toContain(r.category);
      expect(['deterministic', 'baseline', 'reconciliation']).toContain(r.layer);
      expect(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(r.severity);
      expect(['realtime', 'near_realtime', 'batch']).toContain(r.evaluationMode);
      expect(r.humanReview).toBe(true); // every rule is reviewable, never auto-acted
      expect(r.description.length).toBeGreaterThan(10);
    }
  });
  it('covers all nine deterministic alert types + baseline + reconciliation', () => {
    const types = new Set(RULE_CATALOG.map((r) => r.alertType));
    for (const t of ['duplicate_charge_exact', 'refund_exceeds_capture', 'refund_method_mismatch', 'discount_exceeds_subtotal', 'failed_payment_retry_loop', 'paid_ticket_no_capture', 'capture_on_cancelled_ticket', 'reversal_rate_outlier', 'duplicate_membership_charge', 'cash_drawer_variance']) {
      expect(types.has(t)).toBe(true);
    }
  });
});

describe('getRuleCatalog flag overlay', () => {
  it('marks baseline rules disabled when baselines are off', () => {
    const { rules } = getRuleCatalog({ AI_MONEY_PROTECTION_BASELINES_ENABLED: '0' } as any);
    expect(rules.find((r) => r.layer === 'baseline')!.enabled).toBe(false);
    expect(rules.find((r) => r.layer === 'deterministic')!.enabled).toBe(true);
  });
  it('marks all rules disabled when the master flag is off', () => {
    const { rules } = getRuleCatalog({ AI_MONEY_PROTECTION_ENABLED: '0' } as any);
    expect(rules.every((r) => r.enabled === false)).toBe(true);
  });
});

describe('service.getRules', () => {
  it('returns the catalog for a viewer, blocked when not entitled', async () => {
    const ok = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => true));
    const res = await ok.getRules(ctx(['ai_money_protection.view']));
    expect(res.rules.length).toBe(RULE_CATALOG.length);
    const denied = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => false));
    await expect(denied.getRules(ctx(['ai_money_protection.view']))).rejects.toThrow();
  });
});
