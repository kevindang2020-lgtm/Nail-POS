// BUILD_PLAN Phase 9 (Constitution 2 §148 + field-level access): who sees inventory COST is decided by permissions —
// the technician's limited view (inventory.view_limited) hides it unless inventory.cost.view is granted — never by the
// TECHNICIAN role's name.
import { describe, it, expect } from 'vitest';
import { permissionsFor } from '@aipowersalon/permissions';
import { InventoryService } from './inventory.service';

const svc = new InventoryService(null);
const costBlind = (role: string, permissions: string[]) => (svc as any).isTechOnly({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions });

describe('inventory cost visibility', () => {
  it('a technician session (limited view, no cost key) is cost-blind', () => {
    expect(costBlind('TECHNICIAN', permissionsFor('TECHNICIAN' as any))).toBe(true);
  });
  it('a technician the owner granted inventory.cost.view sees cost', () => {
    expect(costBlind('TECHNICIAN', [...permissionsFor('TECHNICIAN' as any), 'inventory.cost.view'])).toBe(false);
  });
  it('owners, managers and the front desk are exactly as before (not cost-blind)', () => {
    for (const r of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION']) expect(costBlind(r, permissionsFor(r as any)), r).toBe(false);
  });
  it('the decision follows the permissions, not the role name: a TECHNICIAN-role token with the full view is not blind', () => {
    expect(costBlind('TECHNICIAN', ['inventory.view'])).toBe(false);
    expect(costBlind('MANAGER', ['inventory.view_limited'])).toBe(true);
  });
});
