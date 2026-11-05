import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const detail = vi.hoisted(() => ({
  id: 'CHB-2026-000924', disputeReference: 'CHB-2026-000924', tenantId: 't1', tenantName: 'Pilot Nail Salon', branchName: 'Main',
  amountCents: 124500, reasonCode: '10.4', reason: 'Fraud — Card Absent', transactionRef: 'txn_7f94a1e2', dueBy: '2026-05-08T00:00:00Z',
  status: 'open', evidenceStatus: 'not_requested', processorDecision: 'none', fundsWithdrawnCents: 124500, fundsRecoveredCents: 0, riskLevel: 'high',
  currency: 'USD', reasonCategory: 'fraud_card_absent', processorType: 'fiserv', notes: 'Customer claims unauthorized transaction.',
  openedAt: '2026-05-03T00:00:00Z', submittedAt: null, decidedAt: null, closedAt: null,
  timeline: [] as any[], evidence: [] as any[], outcomes: [] as any[], fundsEvents: [] as any[], notifications: [] as any[],
}));

vi.mock('../api/superAdminApi', () => ({
  disputesApi: {
    overview: vi.fn().mockResolvedValue({
      kpis: { totalOpenDisputes: 10, amountAtRiskCents: 975000, responseDeadlinesThisWeek: 10, evidenceSubmitted: 11, wonDisputes: 4, lostDisputes: 2, fundsWithdrawnCents: 1428500, fundsRecoveredCents: 287500 },
      fundsSummary: { fundsWithdrawnCents: 1428500, fundsRecoveredCents: 287500, netLostCents: 1141000, recoveryRatePct: 20.13 },
      reasonDistribution: [{ code: '10.4', count: 4 }, { code: '13.1', count: 3 }],
      processorDecisionBreakdown: { won: 4, underReview: 6, lost: 2, total: 12 },
      trend: [{ date: '2026-05-01', open: 1, submitted: 0, won: 0, lost: 0 }, { date: '2026-05-02', open: 2, submitted: 1, won: 1, lost: 0 }],
      recentActivity: [{ at: '2026-05-06T14:18:00Z', disputeRef: 'CHB-2026-000922', action: 'Status: submitted', tenantName: 'Pilot Nail Salon', status: 'submitted' }],
      highRiskMerchants: [{ tenantId: 't1', tenantName: 'Pilot Nail Salon', openDisputes: 5, amountAtRiskCents: 500000, riskLevel: 'high' }],
      approachingDeadlines: [{ disputeRef: 'CHB-2026-000924', dueBy: '2026-05-08T00:00:00Z', daysLeft: 2, tenantName: 'Pilot Nail Salon', amountCents: 124500 }],
      counts: { total: 16 },
    }),
    list: vi.fn().mockResolvedValue({
      page: 1, pageSize: 10, total: 16,
      rows: [{ id: 'CHB-2026-000924', disputeReference: 'CHB-2026-000924', tenantId: 't1', tenantName: 'Pilot Nail Salon', branchName: 'Main', amountCents: 124500, reasonCode: '10.4', reason: 'Fraud — Card Absent', transactionRef: 'txn_7f94a1e2', dueBy: '2026-05-08T00:00:00Z', status: 'open', evidenceStatus: 'not_requested', processorDecision: 'none', fundsWithdrawnCents: 124500, fundsRecoveredCents: 0, riskLevel: 'high' }],
    }),
    detail: vi.fn().mockResolvedValue(detail),
    review: vi.fn().mockResolvedValue({ dispute: detail, checklist: { required: ['Proof of service delivery'], recommended: ['Technician notes'] }, missingRequired: ['Proof of service delivery'] }),
    evidence: vi.fn().mockResolvedValue({ checklist: { required: ['Proof of service delivery'], recommended: [] }, evidence: [] }),
    requestEvidence: vi.fn().mockResolvedValue({ ok: true, evidenceStatus: 'requested' }),
    uploadEvidence: vi.fn().mockResolvedValue({ ok: true, evidence: { id: 'e1', evidenceType: 'signed_receipt', fileName: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 100, reviewStatus: 'uploaded', scanStatus: 'clean', includedInSubmission: false, description: null, createdAt: '2026-05-06T00:00:00Z' } }),
    reviewEvidence: vi.fn().mockResolvedValue({ ok: true, evidence: { id: 'e1', evidenceType: 'signed_receipt', fileName: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 100, reviewStatus: 'accepted', scanStatus: 'clean', includedInSubmission: false, description: null, createdAt: '2026-05-06T00:00:00Z' } }),
    submit: vi.fn().mockResolvedValue({ ok: true, idempotent: false, submission: { id: 's1', result: 'accepted', processorRef: 'fiserv-sub-1', createdAt: '2026-05-06T00:00:00Z' }, manifestCount: 1 }),
    notifyTenant: vi.fn().mockResolvedValue({ ok: true, idempotent: false, notification: { id: 'n1', channel: 'in_app', deliveryStatus: 'sent', createdAt: '2026-05-06T00:00:00Z' } }),
    recordOutcome: vi.fn().mockResolvedValue({ ok: true, manualOverride: true, outcome: { id: 'o1', result: 'won', newStatus: 'won', fundsRecoveredCents: 50000 } }),
    deadlines: vi.fn().mockResolvedValue({
      rows: [{ disputeReference: 'CHB-2026-000918', tenantId: 't1', tenantName: 'Pilot Nail Salon', branchName: 'Main', amountCents: 165000, processorType: 'fiserv', reasonCode: '10.4', dueBy: '2026-05-07T00:00:00Z', status: 'needs_evidence', evidenceStatus: 'requested', riskLevel: 'critical', tenantNotified: true, deadlineState: 'due_today', daysRemaining: 1, hoursRemaining: 20, reminderDue: true, missingEvidence: true }],
      summary: { due_today: 1, due_24h: 1, due_48h: 3, due_3d: 4, due_7d: 5, overdue: 0 }, remindersDue: 5, generatedAt: '2026-05-06T12:00:00Z',
    }),
    patterns: vi.fn().mockResolvedValue({
      totals: { count: 16, amountAtRiskCents: 975000, decided: 6, won: 4, lost: 2, winRatePct: 66.67, lossRatePct: 33.33, recoveryRatePct: 20.13, fundsWithdrawnCents: 1428500, fundsRecoveredCents: 287500 },
      byReason: [{ code: '10.4', count: 4, amountCents: 550000 }], byTenant: [{ tenant: 'Pilot Nail Salon', count: 8, open: 5, amountAtRiskCents: 574000, won: 2, lost: 1 }],
      byProcessor: [{ processor: 'fiserv', count: 16 }], byCardPresence: { cardPresent: 2, cardAbsent: 4, other: 10 },
    }),
    highRiskMerchants: vi.fn().mockResolvedValue([{ tenantId: 't1', tenantName: 'Pilot Nail Salon', openDisputes: 5, totalDisputes: 8, lostDisputes: 1, amountAtRiskCents: 574000, riskLevel: 'high', lastReviewedAt: null, nextReviewAt: null, recommendedAction: null, riskReason: null, suggestedRiskLevel: 'critical' }]),
    flagMerchantRisk: vi.fn().mockResolvedValue({ ok: true, merchant: { tenantId: 't1', tenantName: 'Pilot Nail Salon', openDisputes: 5, totalDisputes: 8, lostDisputes: 1, amountAtRiskCents: 574000, riskLevel: 'critical', lastReviewedAt: '2026-05-06T00:00:00Z', nextReviewAt: null, recommendedAction: 'x', riskReason: 'y', suggestedRiskLevel: 'critical' } }),
    exportCsv: vi.fn().mockResolvedValue({ filename: 'chargebacks-disputes-2026-05-06.csv', csv: 'Dispute ID,Dispute Amount\r\nCHB-2026-000924,1245.00' }),
  },
}));

import ChargebacksDisputesScreen from './ChargebacksDisputesScreen';

const renderScreen = () => render(<MemoryRouter><ChargebacksDisputesScreen /></MemoryRouter>);

describe('ChargebacksDisputesScreen', () => {
  it('renders header, subtitle, and the eight KPI cards from real data', async () => {
    renderScreen();
    expect(await screen.findByText(/Chargebacks & Disputes/)).toBeInTheDocument();
    expect(screen.getByText('Manages payment disputes and evidence workflows.')).toBeInTheDocument();
    for (const label of ['Total Open Disputes', 'Dispute Amount at Risk', 'Response Deadlines This Week', 'Evidence Submitted', 'Won Disputes', 'Lost Disputes', 'Funds Withdrawn', 'Funds Recovered']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
  });

  it('renders the tenant-boundary banner and the disputes table', async () => {
    renderScreen();
    expect(await screen.findByText(/Tenants should only see their own disputes/)).toBeInTheDocument();
    expect((await screen.findAllByText('CHB-2026-000924')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Showing 1 to 10 of 16 disputes/)).toBeInTheDocument();
  });

  it('renders all ten Super Admin Actions', async () => {
    renderScreen();
    for (const a of ['Review Disputes', 'Notify Tenants', 'Collect Supporting Evidence', 'Upload Receipts & Records', 'Submit Evidence to the Processor', 'Track Deadlines', 'Record Outcomes', 'Analyze Dispute Patterns', 'Flag High-Risk Merchants', 'Export Chargeback Reports']) {
      expect(await screen.findByText(a)).toBeInTheDocument();
    }
  });

  it('renders the analytics + right-rail modules', async () => {
    renderScreen();
    expect(await screen.findByText('Dispute Trend')).toBeInTheDocument();
    expect(await screen.findByText('Disputes by Reason Code')).toBeInTheDocument();
    expect(await screen.findByText('Processor Decision Breakdown')).toBeInTheDocument();
    expect(await screen.findByText('Recent Dispute Activity')).toBeInTheDocument();
    expect(await screen.findByText('High-Risk Merchants')).toBeInTheDocument();
    expect(await screen.findByText('Approaching Deadlines')).toBeInTheDocument();
    expect(await screen.findByText('Funds Summary')).toBeInTheDocument();
  });

  it('prompts to select a dispute before an evidence action', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Collect Supporting Evidence'));
    expect(await screen.findByText(/Select a dispute in the table first/)).toBeInTheDocument();
  });

  it('opens the Review workspace for the selected dispute', async () => {
    renderScreen();
    const cells = await screen.findAllByText('CHB-2026-000924');
    fireEvent.click(cells[0]); // select the table row
    await waitFor(() => expect(screen.getByText('Reason Code')).toBeInTheDocument()); // detail panel populated
    fireEvent.click(screen.getByText('Review Disputes'));
    expect(await screen.findByText('Review Dispute — CHB-2026-000924')).toBeInTheDocument();
    expect(await screen.findByText('Evidence checklist')).toBeInTheDocument();
  });

  it('opens Track Deadlines without needing a selected dispute', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Track Deadlines'));
    expect(await screen.findByText(/Reminders due:/)).toBeInTheDocument();
    expect(await screen.findByText('Due today')).toBeInTheDocument();
  });

  it('exports the current filtered scope as CSV', async () => {
    const { disputesApi } = await import('../api/superAdminApi');
    (URL as any).createObjectURL = vi.fn(() => 'blob:x'); (URL as any).revokeObjectURL = vi.fn();
    renderScreen();
    fireEvent.click((await screen.findAllByText(/Export Report/))[0]);
    await waitFor(() => expect((disputesApi as any).exportCsv).toHaveBeenCalled());
  });

  it('opens Analyze Dispute Patterns with aggregate rates', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Analyze Dispute Patterns'));
    expect(await screen.findByText('By reason code')).toBeInTheDocument();
    expect(await screen.findByText('66.67%')).toBeInTheDocument();
  });

  it('opens Flag High-Risk Merchants and requires a reason', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Flag High-Risk Merchants'));
    expect(await screen.findByText(/Flag .* for review/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Flag for Risk Review'));
    expect(await screen.findByText(/A risk reason is required/)).toBeInTheDocument();
  });

  it('shows the manual-override warning when recording won without a processor decision', async () => {
    renderScreen();
    const cells = await screen.findAllByText('CHB-2026-000924');
    fireEvent.click(cells[0]);
    await waitFor(() => expect(screen.getByText('Reason Code')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Record Outcomes'));
    expect(await screen.findByText('Record Outcome — CHB-2026-000924')).toBeInTheDocument();
    expect(await screen.findByText(/Manual override/)).toBeInTheDocument(); // processorDecision 'none' + default result 'won'
  });
});
