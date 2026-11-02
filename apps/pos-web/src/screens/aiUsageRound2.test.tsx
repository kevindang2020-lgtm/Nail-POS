// aiUsageRound2 — Four-Module Completion Guide (Oct 30 2026) AI-01 / AI-02 on POS → AI Usage & Limits:
//   the guide's acceptance figures ($52 finalized, $0 paid, $52 due — never "$59 paid"), Pending tax and "No finalized
//   invoice yet" instead of $0, Re-check invoices sends a request key; the branch table shows Salon default / Branch
//   override / Effective / Billing scope / Quota scope, "On" cannot be chosen for an unentitled package, Save sends the
//   row's version, and a manager sees the table read-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { setBranch: vi.fn(), reconcileInvoices: vi.fn() } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: api, posAiUsageApi: {} }));
import { InvoicedFigures, InvoiceTable, BranchSettings } from './aiUsageRound2';

const amounts = (o: Record<string, unknown> = {}) => ({ invoices: 1, finalizedInvoices: 1, draftInvoices: 0, finalizedCents: 5200, finalizedTotalUnknown: false, paidCents: 0, refundedCents: 0,
  outstandingCents: 5200, taxCents: 300, taxState: 'provided', prorationCents: -1000, discountsAndCreditsCents: 0, from: '2026-10-20', ...o });
const X = (o: Record<string, unknown> = {}) => ({ recurringCents: 5900, estimate: { cents: 5900, assumptions: ['subscription_prices', 'excludes_tax_proration_discounts'] }, currentPeriod: amounts(),
  outstandingAllCents: 5200, invoices: [{ id: 'i1', provider: 'stripe', number: 'AI-0001', reference: 'AI-0001', status: 'open', finalized: true, date: '2026-10-29', periodStart: '2026-10-20', periodEnd: '2026-11-19',
    subtotalCents: 5900, prorationCents: -1000, taxCents: 300, taxState: 'provided', discountCents: 0, creditCents: 0, totalCents: 5200, paidCents: 0, refundedCents: 0, dueCents: 5200 }],
  lastRun: null, providerConfigured: false, canReconcile: true, ...o });
const B = (o: Record<string, unknown> = {}) => ({ tenantDefault: { entitled: true, state: 'active', globallyEnabled: true }, quota: { scope: 'shared_tenant', used: 95, limit: 100, unit: 'messages', unattributed: 5, attribution: 'partial' },
  billingScope: 'tenant_subscription', fields: [{ key: 'autoConfirmBookings', type: 'boolean' }], canEdit: true,
  items: [{ branchId: 'b1', name: 'Cherry Hill', override: null, settings: {}, version: 0, updatedAt: null, updatedBy: null, effective: 'on', source: 'inherit', usedThisPeriod: 60 },
          { branchId: 'b2', name: 'Voorhees', override: false, settings: {}, version: 1, updatedAt: '2026-10-30T15:00:00Z', updatedBy: 'Pat Owner', effective: 'off_branch', source: 'branch', usedThisPeriod: 30 }], ...o });
beforeEach(() => { api.setBranch.mockReset().mockResolvedValue({ ok: true, changed: true, version: 1 }); api.reconcileInvoices.mockReset().mockResolvedValue({ status: 'failed', errorCode: 'provider_not_configured', seen: 0 }); });

describe('AI-01 invoice figures', () => {
  it('keeps recurring price, estimate, finalized, paid and outstanding apart (acceptance: $52 / $0 / $52)', () => {
    render(<InvoicedFigures x={X()} />);
    expect(screen.getByTestId('aiu-fig-recurring')).toHaveTextContent('$59.00');
    expect(screen.getByTestId('aiu-fig-finalized')).toHaveTextContent('$52.00');
    expect(screen.getByTestId('aiu-fig-finalized')).toHaveTextContent('tax $3.00');
    expect(screen.getByTestId('aiu-fig-paid')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('aiu-fig-outstanding')).toHaveTextContent('$52.00');
    expect(screen.getByTestId('aiu-assumptions')).toHaveTextContent('excludes tax');
  });
  it('no finalized invoice → "No finalized invoice yet", not $0; missing tax is Pending, not invented', () => {
    render(<InvoicedFigures x={X({ currentPeriod: amounts({ finalizedInvoices: 0, draftInvoices: 1, finalizedCents: null, outstandingCents: null, taxCents: null, taxState: 'pending' }) })} />);
    expect(screen.getByTestId('aiu-fig-finalized')).toHaveTextContent('No finalized invoice yet');
    expect(screen.getByTestId('aiu-fig-paid')).not.toHaveTextContent('$0.00');
  });
  it('the invoice table shows only real invoices; Re-check sends a request key and reports a missing provider', async () => {
    const onR = vi.fn();
    render(<InvoiceTable x={X({ invoices: [{ ...X().invoices[0], taxCents: null, taxState: 'pending', status: 'draft', finalized: false }] })} onReconciled={onR} />);
    expect(within(screen.getByTestId('aiu-invoice-row')).getByText('Pending')).toBeTruthy();
    fireEvent.click(screen.getByTestId('aiu-reconcile'));
    await waitFor(() => expect(api.reconcileInvoices).toHaveBeenCalledWith({ idempotencyKey: expect.any(String) }));
    expect(await screen.findByTestId('aiu-reconcile-msg')).toHaveTextContent(/Nothing was charged/);
    expect(onR).toHaveBeenCalled();
  });
});

describe('AI-02 branch settings', () => {
  it('shows default / override / effective / billing / quota per branch and saves with the version', async () => {
    const saved = vi.fn();
    render(<BranchSettings code="ai_booking_assistant" b={B()} onSaved={saved} />);
    const rows = screen.getAllByTestId('aiu-branch-row');
    expect(within(rows[1]!).getByTestId('aiu-branch-effective')).toHaveTextContent('Off — this branch');
    expect(rows[0]!).toHaveTextContent('Salon subscription (shared)');
    expect(screen.getByTestId('aiu-quota')).toHaveTextContent('5 not linked to a branch');
    fireEvent.change(within(rows[0]!).getByTestId('aiu-branch-override'), { target: { value: 'off' } });
    fireEvent.click(within(rows[0]!).getByTestId('aiu-branch-save'));
    await waitFor(() => expect(api.setBranch).toHaveBeenCalledWith('ai_booking_assistant', 'b1', { overrideEnabled: false, settings: {}, expectedVersion: 0 }));
    expect(saved).toHaveBeenCalled();
  });
  it('"On" cannot be chosen when the salon is not entitled; a manager sees it read-only', () => {
    const { unmount } = render(<BranchSettings code="ai_business_assistant" b={B({ tenantDefault: { entitled: false, state: 'trial_expired', globallyEnabled: true } })} onSaved={() => undefined} />);
    const sel = screen.getAllByTestId('aiu-branch-override')[0] as HTMLSelectElement;
    expect((within(sel).getByText('On') as HTMLOptionElement).disabled).toBe(true);
    unmount();
    render(<BranchSettings code="ai_booking_assistant" b={B({ canEdit: false })} onSaved={() => undefined} />);
    expect(screen.queryByTestId('aiu-branch-override')).toBeNull(); expect(screen.queryByTestId('aiu-branch-save')).toBeNull();
  });
});
