// ai-business-rbac.vitest.spec.ts — slice 14: the dedicated ai_business.view permission.
// Verifies the granular gate maps to the coarse capability, and that the capability is granted to the intended roles
// (OWNER + MANAGER — "owners and authorized managers", §1/§38) and NOT to front-desk/reception/technician/customer.
import { requiredCapability, can, permissionsFor } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';

describe('ai_business.view capability mapping', () => {
  it('maps the granular gate to the coarse capability', () => {
    expect(requiredCapability('pos.ai_business.view')).toBe('ai_business.view');
  });

  it('is decoupled from generic ai.use (a different capability)', () => {
    expect(requiredCapability('pos.ai.view')).toBe('ai.use');
    expect(requiredCapability('pos.ai_business.view')).not.toBe('ai.use');
  });
});

describe('ai_business.view role grants', () => {
  it('is granted to OWNER and MANAGER', () => {
    expect(can('OWNER', 'ai_business.view')).toBe(true);
    expect(can('MANAGER', 'ai_business.view')).toBe(true);
  });

  it('is NOT granted to front-desk, reception, technician, or customer by default', () => {
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'] as const) {
      expect(can(role, 'ai_business.view')).toBe(false);
    }
  });

  it('appears in the OWNER permission set', () => {
    expect(permissionsFor('OWNER')).toContain('ai_business.view');
  });
});

// Static guardrail: every tenant AI-Business endpoint must gate on the dedicated ai_business.view — the module is for
// "owners and authorized managers" (§1). Finer financial/customer/technician data rules are still enforced inside the
// reused report tools. The Super Admin overview uses SuperAdminGuard (not @RequirePermission) and is excluded.
import { readFileSync } from 'fs';
import { join } from 'path';

describe('AI-Business controller gates (static)', () => {
  it('gates every tenant endpoint on pos.ai_business.view only', () => {
    const src = readFileSync(join(__dirname, 'ai-business.controller.ts'), 'utf8');
    const gates = [...src.matchAll(/@RequirePermission\('([^']+)'\)/g)].map((m) => m[1]);
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) expect(g).toBe('pos.ai_business.view');
    // No borrowed reports.* gates should remain on the AI-Business surface.
    expect(src).not.toMatch(/@RequirePermission\('pos\.reports/);
  });
});
