// owner-portfolio-core.vitest.spec.ts — one owner, many salons.
//
// The rules that matter, and the reasons they matter:
//
//   • **A salon switch is a request, not an authorization.** A tampered tenantId must not get an owner into a
//     salon they don't own — the server never takes the tenant from the client, only a lookup key.
//   • **Permissions are per salon.** An owner may edit payroll at Salon A and be report-only at Salon B. Taking
//     the best level they hold anywhere would silently grant write access at a salon where they were deliberately
//     given none.
//   • **Withheld ≠ zero.** A salon whose figures the owner may not see is reported as withheld, not added as 0 —
//     otherwise the portfolio total looks precise while being wrong.
import { describe, it, expect } from 'vitest';
import {
  decideSwitch, canAt, canAtSalon, summarize, isSalonSelectable,
  type OwnerPortfolio, type PortfolioSalon, type SalonTotals,
} from './owner-portfolio-core';

const T_LUXE = '11111111-1111-1111-1111-111111111111';
const T_BELLE = '22222222-2222-2222-2222-222222222222';
const T_RADIANT = '33333333-3333-3333-3333-333333333333';
const T_STRANGER = '99999999-9999-9999-9999-999999999999';

const branch = (id: string, name: string, active = true) =>
  ({ branchId: id, name, city: 'Marlton', state: 'NJ', isActive: active });

const salon = (o: Partial<PortfolioSalon> & Pick<PortfolioSalon, 'tenantId' | 'accessLevel'>): PortfolioSalon => ({
  salonName: 'Salon', storeCode: 'CODE', tenantStatus: 'active', isPrimaryOwner: false, branches: [], ...o,
});

/** Sophia from the spec: owner at two, co-owner at one, report-only at another. */
const sophia: OwnerPortfolio = {
  ownerUserId: 'sophia',
  salons: [
    salon({ tenantId: T_LUXE, accessLevel: 'owner', salonName: 'Luxe Nails & Spa', isPrimaryOwner: true,
            branches: [branch('b-downtown', 'Downtown'), branch('b-marlton', 'Marlton')] }),
    salon({ tenantId: T_BELLE, accessLevel: 'manager', salonName: 'Belle Palace',
            branches: [branch('b-cherry', 'Cherry Hill')] }),
    salon({ tenantId: T_RADIANT, accessLevel: 'report_only', salonName: 'Radiant Nail Bar',
            branches: [branch('b-west', 'West End')] }),
  ],
};

describe('the portfolio is what the owner may see — nothing more', () => {
  it('lists every salon they hold a membership at', () => {
    expect(sophia.salons.map((s) => s.salonName)).toEqual(['Luxe Nails & Spa', 'Belle Palace', 'Radiant Nail Bar']);
  });

  it('a salon they hold NO membership at simply is not there', () => {
    expect(sophia.salons.find((s) => s.tenantId === T_STRANGER)).toBeUndefined();
  });
});

describe('SECURITY: a salon switch is a request, not an authorization', () => {
  it('switching to a salon they own is approved', () => {
    const d = decideSwitch(sophia, T_LUXE);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.tenantId).toBe(T_LUXE);
  });

  it('a TAMPERED tenantId — a salon they do not own — is REFUSED', () => {
    const d = decideSwitch(sophia, T_STRANGER);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('not_a_member');
  });

  it('the refusal does not reveal whether that salon exists', () => {
    const notAMember = decideSwitch(sophia, T_STRANGER);
    const garbage = decideSwitch(sophia, 'not-even-a-uuid');
    if (!notAMember.ok && !garbage.ok) {
      expect(notAMember.message).toBe(garbage.message);   // no oracle for probing the platform
    }
  });

  it('an INACTIVE salon cannot be switched into', () => {
    const p: OwnerPortfolio = { ownerUserId: 'x', salons: [salon({ tenantId: T_LUXE, accessLevel: 'owner', tenantStatus: 'suspended' })] };
    const d = decideSwitch(p, T_LUXE);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('salon_inactive');
  });

  it("a branch id from ANOTHER salon cannot smuggle a cross-tenant context through", () => {
    // 'b-cherry' belongs to Belle Palace. Asking for it *under Luxe* must fail.
    const d = decideSwitch(sophia, T_LUXE, 'b-cherry');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('branch_not_in_salon');
  });

  it('a branch inside the salon IS approved', () => {
    const d = decideSwitch(sophia, T_LUXE, 'b-marlton');
    expect(d.ok).toBe(true);
    if (d.ok) { expect(d.tenantId).toBe(T_LUXE); expect(d.branchId).toBe('b-marlton'); }
  });

  it('an inactive branch is refused', () => {
    const p: OwnerPortfolio = {
      ownerUserId: 'x',
      salons: [salon({ tenantId: T_LUXE, accessLevel: 'owner', branches: [branch('b-closed', 'Closed', false)] })],
    };
    const d = decideSwitch(p, T_LUXE, 'b-closed');
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('branch_inactive');
  });
});

describe('PERMISSIONS ARE PER SALON — never the best one held elsewhere', () => {
  it('Sophia may run payroll at Luxe (owner) but NOT at Radiant (report-only)', () => {
    expect(canAt(sophia, T_LUXE, 'payroll')).toBe(true);
    expect(canAt(sophia, T_RADIANT, 'payroll')).toBe(false);
  });

  it('being an OWNER somewhere does not grant write access anywhere else', () => {
    // She is a primary owner at Luxe. That must buy her nothing at Radiant.
    expect(canAt(sophia, T_RADIANT, 'manage_settings')).toBe(false);
    expect(canAt(sophia, T_RADIANT, 'manage_staff')).toBe(false);
    expect(canAt(sophia, T_RADIANT, 'operate')).toBe(false);
    expect(canAt(sophia, T_RADIANT, 'reports')).toBe(true);      // …but she CAN see reports there
  });

  it('a manager can operate and manage staff, but not payments or settings', () => {
    expect(canAt(sophia, T_BELLE, 'operate')).toBe(true);
    expect(canAt(sophia, T_BELLE, 'manage_staff')).toBe(true);
    expect(canAt(sophia, T_BELLE, 'manage_payments')).toBe(false);
    expect(canAt(sophia, T_BELLE, 'manage_settings')).toBe(false);
  });

  it('a salon they are NOT a member of grants nothing at all', () => {
    for (const cap of ['view', 'reports', 'operate', 'payroll', 'manage_payments']) {
      expect(canAt(sophia, T_STRANGER, cap), cap).toBe(false);
    }
  });

  it('an INACTIVE salon grants nothing, even to its owner', () => {
    const p: OwnerPortfolio = { ownerUserId: 'x', salons: [salon({ tenantId: T_LUXE, accessLevel: 'owner', tenantStatus: 'suspended' })] };
    expect(canAt(p, T_LUXE, 'view')).toBe(false);
    expect(canAt(p, T_LUXE, 'payroll')).toBe(false);
  });

  it('the capability table itself is sane', () => {
    expect(canAtSalon('owner', 'payroll')).toBe(true);
    expect(canAtSalon('report_only', 'operate')).toBe(false);
    expect(canAtSalon('viewer', 'manage_staff')).toBe(false);
    expect(isSalonSelectable({ tenantStatus: 'active' })).toBe(true);
    expect(isSalonSelectable({ tenantStatus: 'suspended' })).toBe(false);
  });
});

describe('portfolio totals — authorized salons only, integer cents', () => {
  const t = (o: Partial<SalonTotals> & { tenantId: string }): SalonTotals => ({
    appointmentsToday: 0, checkedIn: 0, customersWaiting: 0, servicesInProgress: 0, readyForCheckout: 0,
    techniciansWorking: 0, newClientsToday: 0, revenueTodayCents: 0, revenueMonthCents: 0, tipsTodayCents: 0,
    aiReceptionistLive: null, ...o,
  });

  const totals: SalonTotals[] = [
    t({ tenantId: T_LUXE, appointmentsToday: 12, checkedIn: 9, customersWaiting: 3, servicesInProgress: 4, readyForCheckout: 2, techniciansWorking: 5, newClientsToday: 6, revenueTodayCents: 145_50, revenueMonthCents: 2_400_00, tipsTodayCents: 22_75, aiReceptionistLive: true }),
    t({ tenantId: T_BELLE, appointmentsToday: 8, checkedIn: 5, customersWaiting: 1, servicesInProgress: 3, readyForCheckout: 1, techniciansWorking: 3, newClientsToday: 2, revenueTodayCents: 98_25, revenueMonthCents: 1_150_00, tipsTodayCents: 14_00, aiReceptionistLive: true }),
    t({ tenantId: T_RADIANT, appointmentsToday: 4, checkedIn: 3, customersWaiting: 0, servicesInProgress: 1, readyForCheckout: 1, techniciansWorking: 2, newClientsToday: 1, revenueTodayCents: 60_00, revenueMonthCents: 800_00, tipsTodayCents: 9_50, aiReceptionistLive: false }),
  ];

  it('sums only the salons in the portfolio', () => {
    const s = summarize(sophia, totals);
    expect(s.totalSalons).toBe(3);
    expect(s.activeSalons).toBe(3);
    expect(s.totalBranches).toBe(4);
  });

  it("a STRANGER's salon is never included, even if its totals are handed in", () => {
    const withStranger = [...totals, t({ tenantId: T_STRANGER, appointmentsToday: 999, checkedIn: 999, customersWaiting: 999, techniciansWorking: 999, newClientsToday: 999, revenueTodayCents: 999_99, revenueMonthCents: 999_99, tipsTodayCents: 999_99 })];
    const s = summarize(sophia, withStranger);
    // Radiant is report_only, so its 4 appointments are excluded too (no 'view') — but the point here is that the
    // STRANGER's 999s appear nowhere at all.
    expect(s.appointmentsToday).toBe(12 + 8);
    expect(s.revenueTodayCents).toBe(145_50 + 98_25 + 60_00);   // …while its revenue DOES count (she has reports)
  });

  it('money is INTEGER CENTS and sums exactly — no float drift across salons', () => {
    const s = summarize(sophia, totals);
    expect(s.revenueTodayCents).toBe(30_375);           // 145.50 + 98.25 + 60.00
    expect(Number.isInteger(s.revenueTodayCents)).toBe(true);
    expect(Number.isInteger(s.revenueMonthCents)).toBe(true);
    expect(s.tipsTodayCents).toBe(4_625);               // 22.75 + 14.00 + 9.50
  });

  it('report-only Radiant DOES contribute revenue — she may see its reports', () => {
    const s = summarize(sophia, totals);
    expect(s.revenueTodayCents).toBe(145_50 + 98_25 + 60_00);
  });

  it('…but a report-only salon does NOT contribute operational counts', () => {
    const s = summarize(sophia, totals);
    // Radiant is report_only → no 'view' capability → its 4 appointments and 2 technicians are excluded.
    expect(s.appointmentsToday).toBe(12 + 8);
    expect(s.techniciansWorking).toBe(5 + 3);
  });

  it('a salon with NO totals available is WITHHELD, not silently counted as zero', () => {
    const s = summarize(sophia, totals.filter((t) => t.tenantId !== T_BELLE));
    expect(s.salonsWithheldForPermission).toBeGreaterThan(0);
    // Belle's numbers are simply absent — the total does not pretend they were zero.
    expect(s.appointmentsToday).toBe(12);
  });
});

describe('the KPI cards from the reference image', () => {
  const t = (o: any) => ({
    appointmentsToday: 0, checkedIn: 0, customersWaiting: 0, servicesInProgress: 0, readyForCheckout: 0,
    techniciansWorking: 0, newClientsToday: 0, revenueTodayCents: 0, revenueMonthCents: 0, tipsTodayCents: 0,
    aiReceptionistLive: null, ...o,
  });

  const p: OwnerPortfolio = {
    ownerUserId: 'sophia',
    salons: [
      salon({ tenantId: T_LUXE, accessLevel: 'owner', branches: [branch('b1', 'Downtown'), branch('b2', 'Marlton')] }),
      salon({ tenantId: T_BELLE, accessLevel: 'owner', branches: [branch('b3', 'Cherry Hill')] }),
    ],
  };

  it('every card in the image has a real aggregated value', () => {
    const s = summarize(p, [
      t({ tenantId: T_LUXE, appointmentsToday: 80, checkedIn: 50, customersWaiting: 20, servicesInProgress: 11, readyForCheckout: 9, techniciansWorking: 14, newClientsToday: 15, revenueTodayCents: 7_500_00, tipsTodayCents: 700_00, aiReceptionistLive: true }),
      t({ tenantId: T_BELLE, appointmentsToday: 48, checkedIn: 36, customersWaiting: 11, servicesInProgress: 7, readyForCheckout: 5, techniciansWorking: 10, newClientsToday: 8, revenueTodayCents: 5_086_00, tipsTodayCents: 558_00, aiReceptionistLive: true }),
    ]);

    expect(s.totalSalons).toBe(2);
    expect(s.totalBranches).toBe(3);
    expect(s.appointmentsToday).toBe(128);
    expect(s.checkedIn).toBe(86);
    expect(s.customersWaiting).toBe(31);
    expect(s.servicesInProgress).toBe(18);
    expect(s.readyForCheckout).toBe(14);
    expect(s.techniciansWorking).toBe(24);
    expect(s.newClientsToday).toBe(23);
    expect(s.revenueTodayCents).toBe(12_586_00);   // integer cents, exact
    expect(s.tipsTodayCents).toBe(1_258_00);
    expect(s.aiReceptionist).toBe('live');
  });

  it('AI Receptionist is HONEST — "none" when no salon has one', () => {
    // Not "Offline". Offline implies something is broken; this salon simply never set one up.
    const s = summarize(p, [t({ tenantId: T_LUXE }), t({ tenantId: T_BELLE })]);
    expect(s.aiReceptionist).toBe('none');
  });

  it('…and "degraded" when some are live and some are not — never a flat "Online"', () => {
    const s = summarize(p, [
      t({ tenantId: T_LUXE, aiReceptionistLive: true }),
      t({ tenantId: T_BELLE, aiReceptionistLive: false }),
    ]);
    expect(s.aiReceptionist).toBe('degraded');
  });

  it('a report-only salon contributes revenue but NOT the live-operations counts', () => {
    const mixed: OwnerPortfolio = {
      ownerUserId: 'sophia',
      salons: [
        salon({ tenantId: T_LUXE, accessLevel: 'owner' }),
        salon({ tenantId: T_RADIANT, accessLevel: 'report_only' }),
      ],
    };
    const s = summarize(mixed, [
      t({ tenantId: T_LUXE, checkedIn: 10, servicesInProgress: 4, revenueTodayCents: 100_00 }),
      t({ tenantId: T_RADIANT, checkedIn: 99, servicesInProgress: 99, revenueTodayCents: 50_00 }),
    ]);
    expect(s.checkedIn).toBe(10);                 // Radiant's live ops are NOT visible to a reports-only owner
    expect(s.servicesInProgress).toBe(4);
    expect(s.revenueTodayCents).toBe(150_00);     // …but its revenue is
  });
});
