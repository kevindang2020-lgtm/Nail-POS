// ai-inventory-rbac.vitest.spec.ts — the dedicated ai_inventory.view feature permission (owners + authorized managers).
import { requiredCapability, can, permissionsFor } from '@aipowersalon/permissions';
import { describe, it, expect } from 'vitest';

describe('ai_inventory.view capability mapping', () => {
  it('maps the granular gate to the coarse capability', () => {
    expect(requiredCapability('pos.ai_inventory.view')).toBe('ai_inventory.view');
  });
  it('is decoupled from generic ai.use', () => {
    expect(requiredCapability('pos.ai_inventory.view')).not.toBe('ai.use');
  });
});

describe('ai_inventory.view role grants', () => {
  it('granted to OWNER and MANAGER', () => {
    expect(can('OWNER', 'ai_inventory.view')).toBe(true);
    expect(can('MANAGER', 'ai_inventory.view')).toBe(true);
  });
  it('not granted to front-desk, reception, technician, customer', () => {
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'] as const) {
      expect(can(role, 'ai_inventory.view')).toBe(false);
    }
  });
  it('appears in the OWNER permission set', () => {
    expect(permissionsFor('OWNER')).toContain('ai_inventory.view');
  });
});

describe('ai_inventory.manage_recipes (write gate)', () => {
  it('passes through as a coarse capability unchanged', () => {
    expect(requiredCapability('ai_inventory.manage_recipes')).toBe('ai_inventory.manage_recipes');
  });
  it('granted to OWNER and MANAGER only', () => {
    expect(can('OWNER', 'ai_inventory.manage_recipes')).toBe(true);
    expect(can('MANAGER', 'ai_inventory.manage_recipes')).toBe(true);
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'CUSTOMER'] as const) {
      expect(can(role, 'ai_inventory.manage_recipes')).toBe(false);
    }
  });
});
