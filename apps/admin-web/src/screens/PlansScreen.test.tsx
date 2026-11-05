import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const limits = (over: Record<string, number | null>) => ({
  branches: 3, users: 10, technicians: 8, customers: 2500, appointments_monthly: 2000, sms_monthly: 1000,
  email_monthly: 2000, ai_minutes_monthly: 2500, ai_receptionist_calls_monthly: 200, storage_gb: 10, devices: 3,
  integrations: 5, report_retention_days: 90, ...over,
});

const FIXTURE = {
  kpis: {
    totalPlans: 5, activePlans: 5, publicPlans: 5,
    activeTenantsOnPlans: 2, mappedActiveTenants: 0, unmappedActiveSubscriptions: 2,
    monthlyPlanRevenueCents: 0, unlimitedPackages: 0,
    notModeled: ['trialTenants', 'addOnRevenueCents', 'overLimitTenants', 'averagePlanUtilizationPct', 'aiMinutesUsedMonth', 'activePromotionalPlans'],
  },
  plans: [
    { id: 'p2', code: 'professional', name: 'Professional', subtitle: null, planType: 'standard', status: 'active', monthlyPriceCents: 9900, annualPriceCents: 106920, isRecommended: false, isPublic: true, displayOrder: 2, tenantCount: 0, enabledFeatureCount: 11, limits: limits({}) },
    { id: 'p3', code: 'premium', name: 'Premium', subtitle: 'Most Popular', planType: 'standard', status: 'active', monthlyPriceCents: 19900, annualPriceCents: 214920, isRecommended: true, isPublic: true, displayOrder: 3, tenantCount: 0, enabledFeatureCount: 15, limits: limits({ customers: 5000 }) },
    { id: 'p5', code: 'unlimited', name: 'Unlimited', subtitle: 'Unlimited Everything', planType: 'unlimited', status: 'active', monthlyPriceCents: 69900, annualPriceCents: null, isRecommended: false, isPublic: true, displayOrder: 5, tenantCount: 0, enabledFeatureCount: 18, limits: limits({ customers: null, storage_gb: 250, report_retention_days: null }) },
  ],
  planDistribution: [
    { code: 'professional', name: 'Professional', tenantCount: 0 },
    { code: 'premium', name: 'Premium', tenantCount: 0 },
    { code: 'unlimited', name: 'Unlimited', tenantCount: 0 },
  ],
  overagePricing: [
    { metric: 'ai_minutes_monthly', unitPriceCents: 5, tenants: 0, revenueCents: 0 },
    { metric: 'users', unitPriceCents: 1000, tenants: 1, revenueCents: 1000 },
  ],
  overageTotalRevenueCents: 1000,
  addOns: [
    { code: 'ai_receptionist', name: 'AI Receptionist', pricingModel: 'monthly', unitPriceCents: 4900, status: 'active', tenantCount: 0, monthlyRevenueCents: 0 },
  ],
  trialsPromotions: [
    { kind: 'trial', code: 'starter_trial_7', name: 'Starter Trial (7 Days)', tenantCount: 0, endsOn: null, detail: '7-day trial' },
    { kind: 'promotion', code: 'spring_20', name: 'Spring Promo – 20% Off', tenantCount: 0, endsOn: null, detail: '20% off' },
  ],
  tenantSubscriptions: [
    { tenantId: 't1', name: 'Pilot Salon One', planText: 'Standard', planCode: null, monthlyPriceCents: null, status: 'active' },
  ],
  featureAdoption: [
    { featureKey: 'payments', enabledPlans: 5, tenantEnabled: 0 },
    { featureKey: 'ai_receptionist', enabledPlans: 2, tenantEnabled: 1 },
  ],
  utilizationTrend: [
    { capturedOn: '2026-06-29', tenants: 2, tenantsNear: 1, tenantsOver: 0, avgMaxPct: 55 },
    { capturedOn: '2026-06-30', tenants: 2, tenantsNear: 0, tenantsOver: 1, avgMaxPct: 70 },
  ],
};

vi.mock('../api/superAdminPlansApi', () => ({
  usePlansOverview: () => ({ data: FIXTURE, loading: false, error: null, reload: vi.fn() }),
  superAdminPlansApi: {
    create: vi.fn().mockResolvedValue({ id: 'new' }),
    changePricing: vi.fn().mockResolvedValue({ id: 'p2', versionNumber: 2, versions: [] }),
    planUtilization: vi.fn().mockResolvedValue({
      generatedAt: '2026-06-30T00:00:00Z',
      summary: { tenants: 1, tenantsNearLimit: 1, tenantsOverLimit: 0, avgMaxUtilizationPct: 92 },
      tenants: [{ tenantId: 't1', name: 'Pilot Salon One', planText: 'Professional', planCode: 'professional', maxPct: 92, worstStatus: 'near', metrics: [{ metric: 'customers', used: 46, effective: 50, pct: 92, status: 'warning' }] }],
    }),
  },
}));

import { PlansScreen } from './PlansScreen';

describe('PlansScreen (All Plans)', () => {
  it('renders the catalog with real prices/limits and honest gaps for unmodeled data', async () => {
    render(<MemoryRouter><PlansScreen /></MemoryRouter>);
    expect(await screen.findByText('All Plans Directory', { exact: false })).toBeInTheDocument();
    // KPIs: real + honest
    expect(screen.getByText('Total Plans')).toBeInTheDocument();
    expect(screen.getByText('Monthly Plan Revenue')).toBeInTheDocument();
    // directory: real money + limits
    expect(screen.getAllByText('Professional').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$99')).toBeInTheDocument();
    expect(screen.getByText('$699')).toBeInTheDocument();
    expect(screen.getAllByText('Most Popular').length).toBeGreaterThanOrEqual(1);
    // unlimited rendered as "Unlimited", not a number
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThanOrEqual(1);
    // real overage pricing
    expect(screen.getByText('$0.05')).toBeInTheDocument();
    // honest gaps present
    expect(screen.getAllByText('Not connected yet', { exact: false }).length).toBeGreaterThanOrEqual(1);
    // all 11 quick actions
    expect(screen.getByText('Create Subscription Plan')).toBeInTheDocument();
    expect(screen.getByText('View Plan Utilization')).toBeInTheDocument();
    // configurable limits section
    expect(screen.getByText('Configurable Limits', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('2,500 Customers')).toBeInTheDocument();
    // add-ons + trials/promotions wired to real catalog
    expect(screen.getByText('AI Receptionist')).toBeInTheDocument();
    expect(screen.getByText('Starter Trial (7 Days)')).toBeInTheDocument();
    expect(screen.getByText('Spring Promo – 20% Off')).toBeInTheDocument();
    // overage tenants/revenue + total light up from metered charges
    expect(screen.getByText('Total Overage Revenue (Mo.)')).toBeInTheDocument();
    expect(screen.getAllByText('$10.00').length).toBeGreaterThan(0);
    // upgrade/downgrade tenant workflow is now live (enabled quick action)
    expect(screen.getByText('Upgrade/Downgrade Tenant')).not.toBeDisabled();
    expect(screen.getByText('Add Promotional Plan')).not.toBeDisabled();
    expect(screen.getByText('Apply Trial Period')).not.toBeDisabled();
    expect(screen.getByText('Assign Custom Limits')).not.toBeDisabled();
    expect(screen.getByText('Enable/Disable Features')).not.toBeDisabled();
    expect(screen.getByText('Configure Default Limits')).not.toBeDisabled();
    expect(screen.getByText('Configure Overage Pricing')).not.toBeDisabled();
    expect(screen.getByText('Create Grandfathered Plan')).not.toBeDisabled();
    expect(screen.getByText('View Plan Utilization')).not.toBeDisabled();
    // utilization-backed panels light up (async)
    expect(await screen.findByText('Avg peak utilization')).toBeInTheDocument();
  });

  it('opens the Add Plan and Change Pricing modals from the wired controls', async () => {
    render(<MemoryRouter><PlansScreen /></MemoryRouter>);
    await screen.findByText('All Plans Directory', { exact: false });
    // Add Plan -> modal with plan fields
    fireEvent.click(screen.getByText('+ Add Plan'));
    expect(await screen.findByText('Plan name *')).toBeInTheDocument();
    expect(screen.getByText('Create Plan')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Close'));
    // Row action -> Change Pricing modal
    fireEvent.click(screen.getByLabelText('Change pricing for Professional'));
    expect(await screen.findByText('Apply Pricing Change')).toBeInTheDocument();
    expect(screen.getByText('Reason *')).toBeInTheDocument();
  });
});
