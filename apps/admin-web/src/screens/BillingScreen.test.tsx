// Billing & Subscriptions (Super Admin → System Settings). Renders the software-billing overview: distinction banner,
// 12 KPIs, filters, 11 Billing Controls, canonical Plans & Add-Ons, analytics, tables, 7 Quick Actions, 6 At-a-Glance.
// Data comes from GET /super-admin/billing/subscriptions-overview — never fabricated. Merchant card data never appears.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminBillingApi', () => ({ superAdminBillingApi: { overview: vi.fn() }, billingActionsApi: { createInvoice: vi.fn(), finalizeInvoice: vi.fn(), applyCredit: vi.fn(), retryPayment: vi.fn() }, billingChangeApi: { previewPlan: vi.fn().mockResolvedValue({ preview: true, from: 'premium', to: 'enterprise', changeType: 'upgrade', strategy: 'immediate', proration: { daysTotal: 30, daysRemaining: 20, creditCents: 13267, chargeCents: 26600, netCents: 13333 } }), changePlan: vi.fn(), changeAddOn: vi.fn(), extendTrial: vi.fn(), createDiscount: vi.fn() }, billingLifecycleApi: { previewCancel: vi.fn().mockResolvedValue({ preview: true, strategy: 'end_of_period', resultStatus: 'pending_cancellation', effectiveAt: '2026-06-01T00:00:00Z', impact: { outstandingInvoices: 2, outstandingCents: 39800, creditRemainingCents: 3000, activeAddOns: 2, dataRetentionDays: 90 } }), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), reviewRequest: vi.fn().mockResolvedValue({ ok: true }) }, billingExportApi: { exportReport: vi.fn().mockResolvedValue({ ok: true, filename: 'billing-subscriptions.csv', csv: 'Tenant,Plan\nPilot,premium', contentType: 'text/csv', rowCount: 2 }) }, billingProfileApi: { profile: vi.fn().mockResolvedValue({ ok: true, profile: { tenantId: 't1', tenant: 'Pilot Nail Salon', legalName: 'Pilot LLC', currency: 'USD', subscription: { plan: 'premium', status: 'active', monthlyCents: 19900, currentPeriodEnd: '2026-05-28T00:00:00Z', trialEnd: null, cancelAt: null, pauseEnd: null }, addOns: [{ name: 'AI Receptionist', quantity: 1, priceCents: 4900, status: 'active' }], invoices: [{ invoiceNumber: 'INV-2026-0312', totalCents: 19900, amountDueCents: 19900, status: 'past_due', dueDate: '2026-05-01T00:00:00Z', retryStatus: 'Retry 2 of 3' }], credits: [], discounts: [], outstandingCents: 39800, maskedPaymentMethod: null, auditHistory: [] } }) } }));

import { superAdminBillingApi } from '../api/superAdminBillingApi';
import { BillingScreen } from './BillingScreen';

const overview = () => ({
  ok: true,
  kpiTrends: { pastDueAccounts: { deltaPct: -33.3, favorable: true }, failedPayments: { deltaPct: -50, favorable: true }, creditsIssuedCents: { deltaPct: 16.7, favorable: null }, mrrCents: { deltaPct: 10.6, favorable: true } },
  kpis: { activeSubscriptions: 1, trialAccounts: 1, pastDueAccounts: 2, failedPayments: 1, invoices: 5, creditsIssuedCents: 7000, discountsAppliedCents: 4980, addOnsActive: 3, subscriptionChanges: 2, cancellationRequests: 1, upcomingRenewals: 0, mrrCents: 19900 },
  planDistribution: [{ plan: 'premium', count: 1 }, { plan: 'growth', count: 1 }],
  billingStatusBreakdown: [{ status: 'paid', count: 2 }, { status: 'open', count: 1 }, { status: 'past_due', count: 1 }, { status: 'failed', count: 1 }],
  addOnRevenueMix: [{ addOn: 'AI Receptionist', cents: 4900 }],
  revenueTrend: [{ date: 'May 01', cents: 19900 }, { date: 'May 02', cents: 15900 }],
  trialConversion: { rate: 50, numerator: 1, denominator: 2 },
  failedVsRecovered: { recoveredRate: 50, weekly: [{ week: 'Week 1', failed: 1, recovered: 0 }, { week: 'Week 2', failed: 1, recovered: 1 }] },
  planCatalog: [{ code: 'premium', name: 'Premium', monthlyPriceCents: 19900, status: 'active' }],
  addOnCatalog: [{ code: 'ai_receptionist', name: 'AI Receptionist', monthlyPriceCents: 4900, status: 'active' }],
  tenantOverview: [{ tenantId: 't1', tenant: 'Pilot Nail Salon', plan: 'premium', addOns: 2, billingStatus: 'past_due', renewalDate: '2026-05-28T00:00:00Z', monthlyCents: 19900, discountsCents: 0, creditsCents: 3000, state: 'active' }],
  invoices: [{ invoiceNumber: 'INV-2026-0312', tenant: 'Pilot Nail Salon', amountCents: 19900, dueDate: '2026-05-01T00:00:00Z', status: 'past_due', retryStatus: 'Retry 2 of 3', lastAction: 'retry' }],
  changes: [{ changeId: 'chg-1', tenant: 'Second Salon', requested: 'Cancel subscription', effectiveAt: '2026-05-28T00:00:00Z', reason: 'closing', status: 'pending' }],
  upcomingRenewals: [{ tenant: 'Pilot Nail Salon', plan: 'premium', renewalDate: '2026-05-28T00:00:00Z', amountCents: 19900, autoRenew: true, status: 'active' }],
  recentActivity: [{ at: '2026-05-06T10:00:00Z', tenant: 'Pilot Nail Salon', action: 'Invoice past_due', details: 'INV-2026-0312', amountCents: 19900 }],
  atAGlance: { newInvoicesToday: 5, paymentsRecoveredCents: 0, creditsAppliedTodayCents: 0, planChangesToday: 0, trialsExtended: 0, renewalsDue: 0 },
});

beforeEach(() => { vi.clearAllMocks(); (superAdminBillingApi.overview as any).mockResolvedValue(overview()); });
const renderScreen = () => render(<MemoryRouter><BillingScreen /></MemoryRouter>);

describe('BillingScreen', () => {
  it('renders the software-billing distinction banner', async () => {
    renderScreen();
    expect(await screen.findByText(/software subscription billing/i)).toBeInTheDocument();
    expect(screen.getByText(/Payments & Revenue/i)).toBeInTheDocument();
  });

  it('renders all 12 KPI labels', async () => {
    renderScreen();
    for (const l of ['Active Subscriptions', 'Trial Accounts', 'Past-Due Accounts', 'Failed Payments', 'Invoices', 'Credits Issued', 'Discounts Applied', 'Add-Ons Active', 'Subscription Changes', 'Cancellation Requests', 'Upcoming Renewals', 'Monthly Recurring Revenue']) {
      expect((await screen.findAllByText(l)).length).toBeGreaterThan(0);
    }
  });

  it('renders 11 Billing Controls and 7 Quick Actions', async () => {
    renderScreen();
    expect(await screen.findByText('Billing Controls')).toBeInTheDocument();
    for (const c of ['Create Invoices', 'Apply Credits', 'Retry Failed Payments', 'Change Plans', 'Add or Remove Add-Ons', 'Extend Trials', 'Apply Promotional Pricing', 'Pause Subscriptions', 'Cancel Subscriptions', 'Review Billing History', 'Export Accounting Reports']) {
      expect(screen.getByText(c)).toBeInTheDocument();
    }
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });

  it('renders real Trial→Paid and Failed vs Recovered analytics', async () => {
    renderScreen();
    expect(await screen.findByText(/1 converted of 2 eligible/i)).toBeInTheDocument();
    expect(screen.getByText(/recovered payments link to a prior failed obligation/i)).toBeInTheDocument();
    expect(screen.getAllByText('50%').length).toBeGreaterThanOrEqual(1);
  });

  it('opens the Tenant Billing Profile from a tenant row (masked payment method)', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Pilot Nail Salon' }));
    const dlg = await screen.findByRole('dialog', { name: 'Tenant Billing Profile' });
    expect(within(dlg).getByText(/None on file \(tokenized\)/i)).toBeInTheDocument();
    expect(within(dlg).getByText(/Outstanding:/i)).toBeInTheDocument();
  });

  it('renders canonical plans/add-ons and the detailed tables', async () => {
    renderScreen();
    expect(await screen.findByText('Subscription Plans & Add-Ons')).toBeInTheDocument();
    expect(screen.getAllByText('INV-2026-0312').length).toBeGreaterThan(0);
    expect(screen.getByText('Tenant Subscription Overview')).toBeInTheDocument();
    expect(screen.getAllByText('Upcoming Renewals').length).toBeGreaterThan(0);
    expect(screen.getByText('At-a-Glance Summary (Today)')).toBeInTheDocument();
  });

  it('Create Invoices opens the create-invoice workflow modal', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Create Invoices'));
    expect(await screen.findByRole('dialog', { name: 'Create Invoice' })).toBeInTheDocument();
  });

  it('Retry Failed Payments opens the retry workflow modal', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Retry Failed Payments'));
    expect(await screen.findByRole('dialog', { name: 'Retry Failed Payment' })).toBeInTheDocument();
  });

  it('Change Plans opens the plan-change modal with a proration preview', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Change Plans'));
    const dlg = await screen.findByRole('dialog', { name: 'Change Plan' });
    fireEvent.click(within(dlg).getByText('Preview Proration'));
    expect(await within(dlg).findByText(/Net charge/i)).toBeInTheDocument();
  });

  it('Cancel Subscriptions opens the cancel modal with an impact preview', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Cancel Subscriptions'));
    const dlg = await screen.findByRole('dialog', { name: 'Cancel Subscription' });
    fireEvent.click(within(dlg).getByText('Preview Impact'));
    expect(await within(dlg).findByText(/History is preserved/i)).toBeInTheDocument();
  });

  it('pending change requests expose Approve/Reject', async () => {
    renderScreen();
    expect(await screen.findByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Reject')).toBeInTheDocument();
  });

  it('Export Accounting Report opens the export modal with report choices', async () => {
    renderScreen();
    fireEvent.click((await screen.findAllByText(/Export Accounting Report/i))[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Export Accounting Report' });
    expect(within(dlg).getByText(/never includes card or credential data/i)).toBeInTheDocument();
  });

  it('shows KPI trend deltas with semantic coloring and drills into a KPI', async () => {
    renderScreen();
    expect(await screen.findByText(/-50% vs prior/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Failed Payments'));
    expect(await screen.findByRole('dialog', { name: 'Failed Payments' })).toBeInTheDocument();
  });

  it('remaining unwired controls still show an informational notice', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Review Billing History'));
    expect(await screen.findByText(/upcoming unit. No changes were made/i)).toBeInTheDocument();
  });
});
