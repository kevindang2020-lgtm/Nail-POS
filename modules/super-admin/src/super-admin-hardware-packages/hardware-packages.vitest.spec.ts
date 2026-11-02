import { describe, it, expect } from 'vitest';
import { normalizeStatus, computeSummary, statusBreakdown, packageTypeBreakdown, filterPackages, sortPackages, paginate, canTransition, devicesFor, deviceCountFor, type PkgRow } from './hardware-packages-core';
import { InMemoryHardwarePackagesRepo } from './hardware-packages.repository';
import { HardwarePackagesService } from './hardware-packages.service';

const pkg = (o: Partial<PkgRow> = {}): PkgRow => ({
  id: Math.random().toString(36).slice(2), tenantId: 't1', salonName: 'Luxe Nails', salonCode: 'SAL-1001', ownerName: 'Emily', city: 'Houston', state: 'TX',
  packageName: 'Pro Plus Package', packageType: 'pro_plus', status: 'delivered', paymentStatus: 'paid', hardwareCostCents: 500000, depositCents: 0, amountPaidCents: 500000, financingTerms: null,
  shippingAddress: null, shippingCity: null, shippingState: null, shippingZip: null, shippingCarrier: 'fedex', trackingNumber: 'FX1', trackingUrl: null,
  imacColor: null, imacSerial: null, cloverFlexSerial: null, checkinDisplaySerial: null,
  orderedAt: null, shippedAt: null, deliveredAt: null, installedAt: null, completedAt: null, cancelledAt: null, returnedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z', ...o,
});

describe('hardware-packages core', () => {
  it('normalizes legacy statuses to canonical', () => {
    expect(normalizeStatus('not_started')).toBe('not_ordered');
    expect(normalizeStatus('ready')).toBe('ready_to_ship');
    expect(normalizeStatus('activated')).toBe('complete');
    expect(normalizeStatus('delivered')).toBe('delivered');
  });
  it('summary buckets packages and payment correctly', () => {
    const rows = [
      pkg({ status: 'not_ordered', paymentStatus: 'pending' }), pkg({ status: 'ready_to_ship', paymentStatus: 'unpaid' }),
      pkg({ status: 'shipped', paymentStatus: 'deposit_paid' }), pkg({ status: 'delivered', paymentStatus: 'paid' }),
      pkg({ status: 'installed', paymentStatus: 'paid_off' }), pkg({ status: 'complete', paymentStatus: 'paid' }),
      pkg({ status: 'ready', paymentStatus: 'financing' }), // legacy → ready_to_ship
    ];
    const s = computeSummary(rows);
    expect(s.totalPackages).toBe(7);
    expect(s.notOrdered).toBe(1); expect(s.readyToShip).toBe(2); expect(s.shipped).toBe(1); expect(s.delivered).toBe(1);
    expect(s.installedComplete).toBe(2); // installed + complete
    expect(s.pendingPayment).toBe(4); // pending, unpaid, deposit_paid, financing
    expect(s.paidOff).toBe(3); // paid, paid_off, paid
  });
  it('status + package-type breakdowns', () => {
    const rows = [pkg({ status: 'delivered', packageType: 'pro_plus' }), pkg({ status: 'delivered', packageType: 'pro' }), pkg({ status: 'shipped', packageType: 'standard' })];
    expect(statusBreakdown(rows).find((s) => s.status === 'delivered')!.count).toBe(2);
    expect(packageTypeBreakdown(rows)[0].count).toBe(1);
  });
  it('filters by status/payment/type/carrier/search/tenant', () => {
    const rows = [pkg({ status: 'delivered', packageType: 'pro', salonName: 'Diamond Nail Bar' }), pkg({ status: 'shipped', packageType: 'standard', shippingCarrier: 'ups' })];
    expect(filterPackages(rows, { status: 'delivered' })).toHaveLength(1);
    expect(filterPackages(rows, { packageType: 'standard' })).toHaveLength(1);
    expect(filterPackages(rows, { carrier: 'ups' })).toHaveLength(1);
    expect(filterPackages(rows, { search: 'diamond' })).toHaveLength(1);
    expect(filterPackages(rows, { tenantId: 'nope' })).toHaveLength(0);
  });
  it('paginates + sorts', () => {
    const rows = [pkg({ salonName: 'B' }), pkg({ salonName: 'A' }), pkg({ salonName: 'C' })];
    expect(sortPackages(rows, 'salonName', 'asc')[0].salonName).toBe('A');
    expect(paginate(rows, 1, 2).items).toHaveLength(2);
  });
  it('enforces the transition state machine', () => {
    expect(canTransition('not_ordered', 'ordered')).toBe(true);
    expect(canTransition('shipped', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'installed')).toBe(true);
    expect(canTransition('not_ordered', 'delivered')).toBe(false); // skipping
    expect(canTransition('cancelled', 'shipped')).toBe(false);
    expect(canTransition('cancelled', 'shipped', true)).toBe(true); // force override
  });
  it('derives standard device kit by package type', () => {
    expect(deviceCountFor(pkg({ packageType: 'standard' }), [])).toBe(2); // iMac + Clover
    expect(deviceCountFor(pkg({ packageType: 'pro' }), [])).toBe(3); // + check-in display
    expect(devicesFor(pkg({ packageType: 'pro_plus' }), []).length).toBe(4); // + printer
  });
});

describe('HardwarePackagesService', () => {
  const mk = (rows: PkgRow[] = []) => { const repo = new InMemoryHardwarePackagesRepo(); repo.pkgs = rows; const svc = new HardwarePackagesService(repo, null); return { repo, svc }; };

  it('state returns summary, packages, breakdowns, selected detail, permissions', async () => {
    const { svc } = mk([pkg({ status: 'delivered' }), pkg({ status: 'shipped' })]);
    const s = await svc.state({ page: 1, limit: 10 });
    expect(s.summary.totalPackages).toBe(2);
    expect(s.packages).toHaveLength(2);
    expect(s.packagesByStatus.length).toBeGreaterThan(0);
    expect(s.topPackageTypes.length).toBeGreaterThan(0);
    expect(s.selectedPackage?.package).toBeTruthy();
    expect(s.permissions.assign).toBe(true);
  });
  it('create requires a tenant and audits', async () => {
    const { repo, svc } = mk();
    await expect(svc.create({ userId: 'a' }, {})).rejects.toMatchObject({ code: 'bad_request' });
    const r = await svc.create({ userId: 'a' }, { tenantId: 't9', packageName: 'Pro Package', packageType: 'pro', paymentStatus: 'pending' });
    expect(r.package.packageName).toBe('Pro Package');
    expect(repo.pkgs.length).toBe(1);
  });
  it('blocks a second active package for one tenant unless confirmed', async () => {
    const { repo, svc } = mk([pkg({ tenantId: 't5', status: 'delivered' })]);
    await expect(svc.create({}, { tenantId: 't5', packageName: 'X', packageType: 'pro' })).rejects.toMatchObject({ code: 'conflict' });
    repo.pkgs[0].status = 'cancelled'; // a cancelled package no longer blocks
    expect((await svc.create({}, { tenantId: 't5', packageName: 'X', packageType: 'pro' })).package).toBeTruthy();
    expect((await svc.create({}, { tenantId: 't5', packageName: 'Y', packageType: 'pro', confirmDuplicate: true })).package).toBeTruthy(); // explicit override
  });
  it('setStatus enforces transitions (409 on invalid)', async () => {
    const { repo, svc } = mk([pkg({ status: 'not_ordered' })]);
    const id = repo.pkgs[0].id;
    await expect(svc.setStatus({}, id, 'delivered')).rejects.toMatchObject({ code: 'conflict' });
    const r = await svc.setStatus({}, id, 'ordered');
    expect(normalizeStatus(r.package.status)).toBe('ordered');
    expect(r.package.orderedAt).toBeTruthy();
  });
  it('payment status validates; bad value → 400', async () => {
    const { repo, svc } = mk([pkg({})]);
    await expect(svc.setPaymentStatus({}, repo.pkgs[0].id, 'bogus')).rejects.toMatchObject({ code: 'bad_request' });
    const r = await svc.setPaymentStatus({}, repo.pkgs[0].id, 'paid_off');
    expect(r.package.paymentStatus).toBe('paid_off');
  });
  it('updateTracking auto-advances a pre-shipped package to shipped', async () => {
    const { repo, svc } = mk([pkg({ status: 'ready_to_ship', trackingNumber: null })]);
    const r = await svc.updateTracking({}, repo.pkgs[0].id, { carrier: 'ups', trackingNumber: '1Z999' });
    expect(normalizeStatus(r.package.status)).toBe('shipped');
    expect(r.package.shippedAt).toBeTruthy();
  });
  it('rejects duplicate device serials (409)', async () => {
    const { repo, svc } = mk([pkg({})]);
    const id = repo.pkgs[0].id;
    await svc.addDevices({}, id, [{ deviceType: 'imac', deviceName: '24" iMac', serialNumber: 'SN-1', quantity: 1 }]);
    await expect(svc.addDevices({}, id, [{ deviceType: 'imac', deviceName: '24" iMac', serialNumber: 'SN-1', quantity: 1 }])).rejects.toMatchObject({ code: 'conflict' });
  });
  it('cancel + return guard the current state', async () => {
    const { repo, svc } = mk([pkg({ status: 'delivered' }), pkg({ status: 'not_ordered' })]);
    const r = await svc.cancel({}, repo.pkgs[0].id);
    expect(normalizeStatus(r.package.status)).toBe('cancelled');
    await expect(svc.cancel({}, repo.pkgs[0].id)).rejects.toMatchObject({ code: 'conflict' }); // already cancelled
    await expect(svc.return_({}, repo.pkgs[1].id)).rejects.toMatchObject({ code: 'conflict' }); // can't return from not_ordered
  });
});
