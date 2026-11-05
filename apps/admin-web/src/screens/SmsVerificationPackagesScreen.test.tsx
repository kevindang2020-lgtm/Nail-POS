// SmsVerificationPackagesScreen.test.tsx — P4 pins. Fakes the api module (vi.mock) and drives the real screen:
// packages render · §5 edit saves INTEGER CENTS on the wire · enable/disable calls through · §44 filters slice
// correctly · assign refuses a blank reason CLIENT-SIDE and posts with one · credit validates whole positive
// amounts + reason. No native dialogs anywhere — everything inline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SmsVerificationPackagesScreen from './SmsVerificationPackagesScreen';
import { superAdminSmsApi } from '../api/superAdminSmsApi';

vi.mock('../api/superAdminSmsApi', () => {
  const packages = [
    { id: 'p1', code: 'sms_starter', name: 'Package 1 — Starter', description: null, monthlyPriceCents: 1900, includedVerificationCount: 500, overageEnabled: false, overageUnitPriceCents: 0, hardLimitEnabled: true, warningThresholdPercent: 80, criticalThresholdPercent: 95, selfServiceAvailable: false, active: true, displayOrder: 1, tenantCount: 2, createdAt: '2026-07-01', updatedAt: '2026-07-29' },
    { id: 'p2', code: 'sms_growth', name: 'Package 2 — Growth', description: null, monthlyPriceCents: 4900, includedVerificationCount: 2000, overageEnabled: true, overageUnitPriceCents: 3, hardLimitEnabled: false, warningThresholdPercent: 80, criticalThresholdPercent: 95, selfServiceAvailable: true, active: true, displayOrder: 2, tenantCount: 5, createdAt: '2026-07-01', updatedAt: '2026-07-29' },
  ];
  const tenants = [
    { tenantId: 't1', tenantName: 'Palace Nails', tenantStatus: 'active', packageName: 'Package 2 — Growth', packageCode: 'sms_growth', pendingChange: false, included: 2000, used: 1900, overage: 0, failed: 1, pctUsed: 95, hardLimit: false, estimatedBillCents: 4900, cycleStart: '2026-07-01', cycleEnd: '2026-07-31', lastSmsAt: '2026-07-29T12:00:00Z' },
    { tenantId: 't2', tenantName: 'Sunrise Spa', tenantStatus: 'active', packageName: null, packageCode: null, pendingChange: false, included: null, used: null, overage: 0, failed: 0, pctUsed: null, hardLimit: false, estimatedBillCents: null, cycleStart: null, cycleEnd: null, lastSmsAt: null },
    { tenantId: 't3', tenantName: 'Over Salon', tenantStatus: 'active', packageName: 'Package 2 — Growth', packageCode: 'sms_growth', pendingChange: true, included: 2000, used: 2000, overage: 175, failed: 0, pctUsed: 100, hardLimit: false, estimatedBillCents: 4900 + 175 * 3, cycleStart: '2026-07-01', cycleEnd: '2026-07-31', lastSmsAt: '2026-07-29T13:00:00Z' },
  ];
  return {
    superAdminSmsApi: {
      listPackages: vi.fn(async () => ({ packages })),
      listTenantPlans: vi.fn(async () => ({ tenants })),
      updatePackage: vi.fn(async () => packages[0]),
      setPackageActive: vi.fn(async () => packages[0]),
      assignPackage: vi.fn(async () => ({ effective: 'immediate', effectiveAt: '2026-07-29' })),
      addCredit: vi.fn(async () => ({ hasPackage: true })),
      tenantPlan: vi.fn(async () => ({ assignment: null, balance: { hasPackage: false }, recentChanges: [] })),
      listFindings: vi.fn(async () => ({ findings: [
        { id: 'f1', runDate: '2026-07-29', tenantId: 't3', tenantName: 'Over Salon', cycleId: 'c1', findingType: 'counter_ledger_mismatch', details: { ledgerBillable: 2, counterTotal: 7 }, updatedAt: '2026-07-29T04:00:00Z' },
      ] })),
      resolveFinding: vi.fn(async () => ({ ok: true })),
      getControls: vi.fn(async () => ({ 'sms.verification_platform_enabled': true, 'sms.package_billing_enabled': true, 'sms.new_tenant_enrollment_enabled': true, 'sms.emergency_send_disabled': false })),
      getDefaultPackage: vi.fn(async () => ({ defaultPackageCode: null })),
      setDefaultPackage: vi.fn(async () => ({ defaultPackageCode: 'sms_growth' })),
      tenantUsage: vi.fn(async () => ({ records: [
        { requestedAt: '2026-07-29T12:00:00Z', purpose: 'BOOKING_VERIFICATION', category: 'TENANT_VERIFICATION', status: 'DELIVERED', billable: true, unitPriceCents: 0, recipientMasked: '***-***-1234', hasSid: true },
      ] })),
      setControl: vi.fn(async () => ({ 'sms.verification_platform_enabled': true, 'sms.package_billing_enabled': true, 'sms.new_tenant_enrollment_enabled': true, 'sms.emergency_send_disabled': true })),
      analytics: vi.fn(async () => ({ month: '2026-07', totals: { subscriptionRevenueCents: 9800, overageRevenueCents: 525, costAvailable: false, providerCostCents: null, grossMarginCents: null, grossMarginPct: null }, perPackage: [{ packageCode: 'sms_growth', packageName: 'Package 2 — Growth', tenants: 2, subscriptionRevenueCents: 9800, overageRevenueCents: 525, smsSent: 4175, smsFailed: 1 }], byPurpose: [{ purpose: 'BOOKING_VERIFICATION', count: 4000 }], byStatus: [{ status: 'SUBMITTED', count: 4176 }] })),
      charges: vi.fn(async () => ({ month: '2026-07', totalCents: 10325, tenants: [{ tenantId: 't1', tenantName: 'Palace Nails', packageCode: 'sms_growth', baseCents: 4900, overageCents: 0, totalCents: 4900 }] })),
    },
  };
});

const mocked = superAdminSmsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => { Object.values(mocked).forEach((f) => f.mockClear()); });

describe('SmsVerificationPackagesScreen', () => {
  it('renders both packages and the tenant table; a package-less tenant shows honest dashes', async () => {
    render(<SmsVerificationPackagesScreen />);
    expect((await screen.findAllByText('Package 1 — Starter')).length).toBeGreaterThanOrEqual(1);   // packages table + default-package select options
    expect(screen.getAllByText('Package 2 — Growth').length).toBeGreaterThanOrEqual(1);   // packages table + tenant rows + select
    const sunrise = screen.getByText('Sunrise Spa').closest('tr')!;
    expect(within(sunrise).getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('§5 edit: saving sends INTEGER CENTS, never floats', async () => {
    render(<SmsVerificationPackagesScreen />);
    fireEvent.click((await screen.findAllByText('Edit'))[0]);
    const price = screen.getByLabelText(/Monthly Price/);
    fireEvent.change(price, { target: { value: '29.99' } });
    fireEvent.click(screen.getByText('Save Package'));
    await waitFor(() => expect(mocked.updatePackage).toHaveBeenCalled());
    const [, patch] = mocked.updatePackage.mock.calls[0];
    expect(patch.monthly_price_cents).toBe(2999);
    expect(Number.isInteger(patch.monthly_price_cents)).toBe(true);
  });

  it('warning ≥ critical is refused client-side with an inline error, no API call', async () => {
    render(<SmsVerificationPackagesScreen />);
    fireEvent.click((await screen.findAllByText('Edit'))[0]);
    fireEvent.change(screen.getByLabelText(/Warning Threshold/), { target: { value: '96' } });
    fireEvent.change(screen.getByLabelText(/Critical Threshold/), { target: { value: '95' } });
    fireEvent.click(screen.getByText('Save Package'));
    expect(await screen.findByText(/warning below critical/i)).toBeTruthy();
    expect(mocked.updatePackage).not.toHaveBeenCalled();
  });

  it('enable/disable calls through with the flipped state', async () => {
    render(<SmsVerificationPackagesScreen />);
    fireEvent.click((await screen.findAllByText('Disable'))[0]);
    await waitFor(() => expect(mocked.setPackageActive).toHaveBeenCalledWith('p1', false));
  });

  it('§44 filters: Over Limit shows only the overage tenant; No Package shows only the unassigned one', async () => {
    render(<SmsVerificationPackagesScreen />);
    await screen.findByLabelText('Tenant usage');
    const usage = () => within(screen.getByLabelText('Tenant usage'));   // findings section also names tenants — scope to the table
    fireEvent.click(screen.getByRole('tab', { name: 'Over Limit' }));
    expect(usage().getByText('Over Salon')).toBeTruthy();
    expect(usage().queryByText('Palace Nails')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'No Package' }));
    expect(usage().getByText('Sunrise Spa')).toBeTruthy();
    expect(usage().queryByText('Over Salon')).toBeNull();
  });

  it('§41: saving a default package requires a reason, then posts the code', async () => {
    render(<SmsVerificationPackagesScreen />);
    await screen.findByLabelText('Default package choice');
    fireEvent.change(screen.getByLabelText('Default package choice'), { target: { value: 'sms_growth' } });
    fireEvent.click(screen.getByText('Save Default'));
    expect(await screen.findByText(/reason is required/i)).toBeTruthy();
    expect(mocked.setDefaultPackage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Default package reason'), { target: { value: 'standard onboarding' } });
    fireEvent.click(screen.getByText('Save Default'));
    await waitFor(() => expect(mocked.setDefaultPackage).toHaveBeenCalledWith('sms_growth', 'standard onboarding'));
  });

  it('§46: the Manage expander shows recent usage with masked recipients', async () => {
    render(<SmsVerificationPackagesScreen />);
    await screen.findByLabelText('Tenant usage');
    fireEvent.click(within(within(screen.getByLabelText('Tenant usage')).getByText('Palace Nails').closest('tr')!).getByText('Manage'));
    expect(await screen.findByText('Recent Usage')).toBeTruthy();
    expect(screen.getByText('***-***-1234')).toBeTruthy();
    expect(within(screen.getByLabelText('Recent usage')).getByText('DELIVERED')).toBeTruthy();
  });

  it('§40: the emergency stop needs an explicit reason before it engages', async () => {
    render(<SmsVerificationPackagesScreen />);
    const row = within((await screen.findByText('Emergency Disable Sending')).closest('tr')!);
    expect(row.getByText('Off')).toBeTruthy();
    fireEvent.click(row.getByText('Engage'));
    fireEvent.click(screen.getByText('Confirm'));
    expect(await screen.findByText(/reason is required/i)).toBeTruthy();
    expect(mocked.setControl).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Control reason'), { target: { value: 'runaway spend' } });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(mocked.setControl).toHaveBeenCalledWith('sms.emergency_send_disabled', true, 'runaway spend'));
  });

  it('§22-§24: revenue KPIs render; missing provider cost says EXACTLY "Provider Cost Not Available"', async () => {
    render(<SmsVerificationPackagesScreen />);
    expect(await screen.findByText('Revenue & Analytics — 2026-07')).toBeTruthy();
    expect(screen.getAllByText('$98.00').length).toBeGreaterThanOrEqual(1);   // KPI + per-package row
    expect(screen.getByText('Provider Cost Not Available')).toBeTruthy();
    expect(screen.getByText(/billing feed \(\$103\.25 across 1 tenants/)).toBeTruthy();
  });

  it('§59: open findings render with their numbers; Resolve calls through with the id', async () => {
    render(<SmsVerificationPackagesScreen />);
    expect(await screen.findByText('Counter vs ledger mismatch')).toBeTruthy();
    expect(screen.getByText(/ledgerBillable: 2 · counterTotal: 7/)).toBeTruthy();
    fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() => expect(mocked.resolveFinding).toHaveBeenCalledWith('f1', 'resolved'));
  });

  it('assign refuses a blank reason inline (no call), then posts with reason + tenant id', async () => {
    render(<SmsVerificationPackagesScreen />);
    await screen.findByLabelText('Tenant usage');
    fireEvent.click(within(within(screen.getByLabelText('Tenant usage')).getByText('Palace Nails').closest('tr')!).getByText('Manage'));
    fireEvent.click(screen.getByText('Assign'));
    expect(await screen.findByText(/reason is required/i)).toBeTruthy();
    expect(mocked.assignPackage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Assign reason'), { target: { value: 'busy season' } });
    fireEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(mocked.assignPackage).toHaveBeenCalled());
    const [tenantId, body] = mocked.assignPackage.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(body.reason).toBe('busy season');
  });

  it('credit validates a positive whole amount and reason before calling', async () => {
    render(<SmsVerificationPackagesScreen />);
    await screen.findByLabelText('Tenant usage');
    fireEvent.click(within(within(screen.getByLabelText('Tenant usage')).getByText('Palace Nails').closest('tr')!).getByText('Manage'));
    fireEvent.change(screen.getByLabelText('Credit amount'), { target: { value: '2.5' } });
    fireEvent.change(screen.getByLabelText('Credit reason'), { target: { value: 'goodwill' } });
    fireEvent.click(screen.getByText('Add Credit'));
    expect(await screen.findByText(/positive whole number/i)).toBeTruthy();
    expect(mocked.addCredit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Credit amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Add Credit'));
    await waitFor(() => expect(mocked.addCredit).toHaveBeenCalledWith('t1', { amount: 50, reason: 'goodwill' }));
  });
});
