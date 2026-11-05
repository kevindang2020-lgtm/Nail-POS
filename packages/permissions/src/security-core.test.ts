import { describe, it, expect } from 'vitest';
import { requiredCapability, hasPermission, type Ctx } from './security-core';
import { permissionsFor } from './rbac';

const ctx = (role: any, perms: string[] = []): Ctx => ({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions: perms });

describe('requiredCapability — granular pos.* → coarse catalog capability', () => {
  it('maps view-ish actions to the domain view capability', () => {
    expect(requiredCapability('pos.check_in.view')).toBe('checkin.view');
    expect(requiredCapability('pos.queue.view')).toBe('queue.view');
    expect(requiredCapability('pos.overview.view')).toBe('dashboard.view');
    expect(requiredCapability('pos.customers.notes_view')).toBe('customers.view');
    // Constitution 12 §323: exporting the customer list is its own capability (owners/managers), not "viewing" it —
    // this line used to pin the collapse to customers.view, which handed every staff role a full customer download.
    expect(requiredCapability('pos.customers.export')).toBe('customers.export');
    expect(requiredCapability('pos.reports.view')).toBe('reports.view');
  });
  it('maps manage actions to the domain manage capability (with the catalog naming)', () => {
    expect(requiredCapability('pos.check_in.walk_in')).toBe('checkin.manage');
    expect(requiredCapability('pos.queue.assign_technician')).toBe('queue.manage');
    expect(requiredCapability('pos.serving.mark_done')).toBe('serving.manage');
    expect(requiredCapability('pos.service_done.send_to_checkout')).toBe('serving.manage');
    expect(requiredCapability('pos.tech_queue.move_to_serving')).toBe('queue.manage');
    expect(requiredCapability('pos.tech_appointments.create')).toBe('booking.manage');
    expect(requiredCapability('pos.checkout.take_payment')).toBe('checkout.process_payment');
    expect(requiredCapability('pos.checkout.cash_payment')).toBe('checkout.process_payment');
    expect(requiredCapability('pos.customers.create')).toBe('customers.edit');
    expect(requiredCapability('pos.services.create')).toBe('services.edit');
    expect(requiredCapability('pos.technicians.create')).toBe('technicians.edit');
    expect(requiredCapability('pos.reports.export')).toBe('reports.export');
  });
  it('passes coarse (non-pos.*) keys through unchanged', () => {
    expect(requiredCapability('settings.view')).toBe('settings.view');
  });
});

describe('hasPermission — role gating via the capability mapping', () => {
  it('OWNER (token carries all caps) holds every tenant permission; SUPER_ADMIN holds no tenant permission', () => {
    const owner = ctx('OWNER', permissionsFor('OWNER'));
    expect(hasPermission(owner, 'pos.checkout.take_payment')).toBe(true);
    expect(hasPermission(owner, 'pos.services.create')).toBe(true);
    expect(hasPermission(owner, 'pos.settings.business_branch')).toBe(true);
    expect(hasPermission(ctx('SUPER_ADMIN', permissionsFor('OWNER')), 'pos.checkout.view')).toBe(false);
  });
  it('SUPER_ADMIN passes exactly the super_admin.* keys embedded in its session — never tenant keys, never keys it lacks', () => {
    const sa = ctx('SUPER_ADMIN', permissionsFor('SUPER_ADMIN'));
    expect(hasPermission(sa, 'super_admin.general_settings.view')).toBe(true);
    expect(hasPermission(sa, 'super_admin.integrations.credentials.rotate')).toBe(true);
    expect(hasPermission(sa, 'pos.checkout.view')).toBe(false);          // tenant key: hard fail even if present
    expect(hasPermission(ctx('SUPER_ADMIN', []), 'super_admin.general_settings.view')).toBe(false); // not embedded → fail
    expect(hasPermission(ctx('OWNER', permissionsFor('OWNER')), 'super_admin.general_settings.view')).toBe(false); // owner never holds SA keys
  });
  it('FRONT_DESK can run the full operational money-path', () => {
    const fd = ctx('FRONT_DESK', permissionsFor('FRONT_DESK'));
    for (const k of ['pos.check_in.walk_in', 'pos.check_in.move_to_queue', 'pos.queue.create', 'pos.queue.assign_technician',
      'pos.queue.move_to_serving', 'pos.serving.view', 'pos.serving.mark_done', 'pos.serving.send_to_service_done',
      'pos.service_done.view', 'pos.service_done.quality_check', 'pos.service_done.send_to_checkout', 'pos.checkout.view',
      'pos.checkout.add_tip', 'pos.checkout.take_payment', 'pos.checkout.cash_payment']) {
      expect(hasPermission(fd, k), k).toBe(true);
    }
  });
  it('FRONT_DESK is denied management-only actions (not over-permissive)', () => {
    const fd = ctx('FRONT_DESK', permissionsFor('FRONT_DESK'));
    for (const k of ['pos.services.create', 'pos.technicians.create', 'pos.technicians.edit', 'settings.edit']) {
      expect(hasPermission(fd, k), k).toBe(false);
    }
  });
  it('TECHNICIAN can serve but cannot take payment', () => {
    const t = ctx('TECHNICIAN', permissionsFor('TECHNICIAN'));
    expect(hasPermission(t, 'pos.serving.mark_done')).toBe(true);
    expect(hasPermission(t, 'pos.checkout.take_payment')).toBe(false);
    expect(hasPermission(t, 'pos.services.create')).toBe(false);
  });
});

// 23-inch dual-screen spec §75 (Oct 6 2026): Customer Display Advertising keys resolve to the marketing capability —
// owners and managers manage the salon's ads; front desk and technicians do not. (Before the mapping existed the keys
// resolved to customer_display_ads.view/.manage, which NO role holds — every owner was refused, found live.)
describe('pos.customer_display_ads.* → marketing', () => {
  it('view → marketing.view; every write → marketing.manage', () => {
    expect(requiredCapability('pos.customer_display_ads.view')).toBe('marketing.view');
    for (const a of ['create', 'update', 'publish', 'pause', 'archive']) expect(requiredCapability(`pos.customer_display_ads.${a}`)).toBe('marketing.manage');
  });
  it('owners and managers hold them; front desk, reception and technicians do not', () => {
    const keys = ['view', 'create', 'update', 'publish', 'pause', 'archive'].map((a) => `pos.customer_display_ads.${a}`);
    for (const role of ['OWNER', 'MANAGER']) for (const k of keys) expect(hasPermission(ctx(role, permissionsFor(role as any)), k)).toBe(true);
    for (const role of ['FRONT_DESK', 'RECEPTION', 'TECHNICIAN']) for (const k of keys) expect(hasPermission(ctx(role, permissionsFor(role as any)), k)).toBe(false);
  });
});

// 23-inch dual-screen spec §82, §86 (Oct 6 2026): the people who run checkout OPERATE the customer display (send, refresh,
// cancel, switch, see its status); pairing, renaming, register assignment, maintenance and revoking are the owner's.
// (Every display action used to require pos.customer_display.manage → settings.edit: the front desk got 403 on "To Display".)
describe('pos.customer_display.* — the front desk operates the display, the owner manages it (§82, §86)', () => {
  it('operate → the checkout capability; manage → settings.edit', () => {
    expect(requiredCapability('pos.customer_display.operate')).toBe('checkout.process_payment');
    expect(requiredCapability('pos.customer_display.manage')).toBe('settings.edit');
  });
  it('owner, manager, front desk and reception operate it; a technician does not; only the owner manages it', () => {
    for (const role of ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION']) expect(hasPermission(ctx(role, permissionsFor(role as any)), 'pos.customer_display.operate')).toBe(true);
    expect(hasPermission(ctx('TECHNICIAN', permissionsFor('TECHNICIAN' as any)), 'pos.customer_display.operate')).toBe(false);
    expect(hasPermission(ctx('OWNER', permissionsFor('OWNER' as any)), 'pos.customer_display.manage')).toBe(true);
    for (const role of ['MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN']) expect(hasPermission(ctx(role, permissionsFor(role as any)), 'pos.customer_display.manage')).toBe(false);
  });
});

describe('Phase 3: manager-level customer phone powers', () => {
  // They used to collapse to customers.edit, which reception holds — only the phone service's role check stood in the way.
  it('reception holds customers.edit but NOT the manager phone powers; managers and owners do', async () => {
    const { hasPermission } = await import('./security-core');
    const { permissionsFor } = await import('./rbac');
    for (const key of ['pos.customers.phone.manual_confirm', 'pos.customers.phone.approve', 'pos.customers.phone.resolve', 'pos.customers.phone.settings', 'pos.customers.phone.retry_sync']) {
      expect(hasPermission({ role: 'RECEPTION', permissions: permissionsFor('RECEPTION') } as any, key), key).toBe(false);
      expect(hasPermission({ role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') } as any, key), key).toBe(false);
      expect(hasPermission({ role: 'MANAGER', permissions: permissionsFor('MANAGER') } as any, key), key).toBe(true);
      expect(hasPermission({ role: 'OWNER', permissions: permissionsFor('OWNER') } as any, key), key).toBe(true);
    }
    expect(hasPermission({ role: 'RECEPTION', permissions: permissionsFor('RECEPTION') } as any, 'pos.customers.edit')).toBe(true);
  });
});

describe('BUILD_PLAN Phase 4: completing a booking without the phone code is a manager decision', () => {
  it('maps the override (and the waiting list) to booking.override, not the booking.manage reception holds', () => {
    expect(requiredCapability('pos.booking.override_verification')).toBe('booking.override');
    expect(requiredCapability('pos.booking.verification_pending')).toBe('booking.override');
  });
  it('a receptionist cannot pass the guard; an owner and a manager can', () => {
    expect(hasPermission(ctx('RECEPTION', permissionsFor('RECEPTION' as any) as any), 'pos.booking.override_verification')).toBe(false);
    expect(hasPermission(ctx('OWNER', permissionsFor('OWNER' as any) as any), 'pos.booking.override_verification')).toBe(true);
    expect(hasPermission(ctx('MANAGER', permissionsFor('MANAGER' as any) as any), 'pos.booking.override_verification')).toBe(true);
  });
});

describe('BUILD_PLAN Phase 5, bug 2: deals and coupons are front-desk work; a manual discount is not', () => {
  it('pos.deals.apply maps to deals.apply (not checkout.manage_overrides)', () => {
    expect(requiredCapability('pos.deals.apply')).toBe('deals.apply');
    expect(requiredCapability('pos.checkout.apply_discount')).toBe('checkout.manage_overrides');
  });
  it('reception and front desk apply deals; neither types a manual discount; a technician does neither', () => {
    for (const role of ['RECEPTION', 'FRONT_DESK', 'MANAGER', 'OWNER']) expect(hasPermission(ctx(role, permissionsFor(role as any) as any), 'pos.deals.apply')).toBe(true);
    for (const role of ['RECEPTION', 'FRONT_DESK']) expect(hasPermission(ctx(role, permissionsFor(role as any) as any), 'pos.checkout.apply_discount')).toBe(false);
    expect(hasPermission(ctx('TECHNICIAN', permissionsFor('TECHNICIAN' as any) as any), 'pos.deals.apply')).toBe(false);
  });
});
