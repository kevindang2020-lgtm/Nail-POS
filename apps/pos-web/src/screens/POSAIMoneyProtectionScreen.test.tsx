// POSAIMoneyProtectionScreen — the Money Protection overview (guides of Nov 3 2026): the cards come from the center, value under review is
// framed as "not a confirmed loss", the monitoring line says when detection never ran (never "no alerts"), Run detection now and the
// read-only check render honestly.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { mc, api } = vi.hoisted(() => {
  const mc = { summary: vi.fn(), alerts: vi.fn(), alert: vi.fn(), alertAction: vi.fn(), investigations: vi.fn(), timeline: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), history: vi.fn(), runs: vi.fn(), runDetection: vi.fn(), check: vi.fn() };
  return { mc, api: { center: mc, explainAlert: vi.fn(), createInvestigation: vi.fn(), addNote: vi.fn(), assignInvestigation: vi.fn(), setInvestigationStatus: vi.fn(), resolveInvestigation: vi.fn() } };
});
vi.mock('../api/posAIMoneyProtectionApi', () => ({ posAIMoneyProtectionApi: api }));
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' }, ...o });
const wrap = (el: any) => render(<MemoryRouter>{el}</MemoryRouter>);

import { POSAIMoneyProtectionScreen } from './POSAIMoneyProtectionScreen';
const SUM = (o: any = {}) => ({ cards: { newAlerts: 4, openAlerts: 6, critical: 1, high: 2, valueUnderReviewCents: 12500, openInvestigations: 1, unassignedInvestigations: 0, dismissed30d: 2, raised30d: 9 },
  byCategory: { duplicate_charge: 3, refund: 1 }, monitoring: 'current', scheduled: true, lastRun: null, lastSuccessAt: '2026-11-03T05:00:00Z', ...o });
beforeEach(() => { vi.clearAllMocks(); mc.runs.mockResolvedValue(page([{ id: 'r1', trigger: 'manual', status: 'succeeded', startedAt: '2026-11-03T05:00:00Z', created: 2, updated: 1, actor: 'Owner Kim' }])); });

describe('POSAIMoneyProtectionScreen (overview)', () => {
  it('AI MONEY PROTECTION 5 · 11: states the notification limits and what they held back in the last 24 hours, from the server', async () => {
    mc.summary.mockResolvedValue(SUM({ notifications: { severities: ['CRITICAL', 'HIGH'], cooldownHours: 24, hourlyCap: 5, audience: 'owner', last24h: { sent: 5, heldCooldown: 2, heldCap: 3, rollUps: 1 } } }));
    wrap(<POSAIMoneyProtectionScreen />);
    const box = await screen.findByTestId('mpx-notify-limits');
    expect(box).toHaveTextContent(/at most once every 24 hours/);
    expect(box).toHaveTextContent(/at most 5 alerts are told per hour/);
    expect(screen.getByTestId('mpx-notify-24h')).toHaveTextContent('Last 24 hours: 5 told · 2 held back by the cooldown · 3 held back by the hourly limit');
    expect(box).toHaveTextContent(/no rule is turned off/);
  });
  it('AI Fraud Money Protection 09: the by-location table shows the server rows, Net Sales from the Sales report, and hides sales when financials are forbidden', async () => {
    const rows = [{ branchId: 'b1', branch: 'Main', openAlerts: 3, critical: 1, valueUnderReviewCents: 7000, netSalesCents: 1250000, salesWindow: { from: '2026-10-05', to: '2026-11-03' } },
      { branchId: 'b2', branch: 'North', openAlerts: 1, critical: 0, valueUnderReviewCents: 300, netSalesCents: 480000, salesWindow: { from: '2026-10-05', to: '2026-11-03' } }];
    mc.summary.mockResolvedValueOnce(SUM({ byBranch: { rows, financials: 'included', salesSource: 'reports.sales.netSalesCents', unbranched: { openAlerts: 2, critical: 0, valueUnderReviewCents: 50 } } }));
    const v = wrap(<POSAIMoneyProtectionScreen />);
    const box = await screen.findByTestId('mpx-bybranch');
    expect(screen.getAllByTestId('mpx-br-row')).toHaveLength(2);
    expect(screen.getAllByTestId('mpx-br-sales')[0]).toHaveTextContent('$12,500.00');
    expect(screen.getByTestId('mpx-br-unbranched')).toHaveTextContent('Salon-wide');
    expect(screen.getByTestId('mpx-br-note')).toHaveTextContent(/Sales report/);
    expect(box).toHaveTextContent(/not a confirmed loss/);
    v.unmount();
    mc.summary.mockResolvedValueOnce(SUM({ byBranch: { rows: rows.map((r) => ({ ...r, netSalesCents: null, salesWindow: null })), financials: 'forbidden', salesSource: null, unbranched: { openAlerts: 0, critical: 0, valueUnderReviewCents: 0 } } }));
    wrap(<POSAIMoneyProtectionScreen />);
    await screen.findByTestId('mpx-bybranch');
    expect(screen.getAllByTestId('mpx-br-sales').map((e) => e.textContent)).toEqual(['—', '—']);
    expect(screen.getByTestId('mpx-br-note')).toHaveTextContent(/cannot view financial reports/);
    expect(screen.queryByTestId('mpx-br-unbranched')).toBeNull();
  });
  it('no notification block when the server sends no limits (never invented)', async () => {
    mc.summary.mockResolvedValue(SUM());
    wrap(<POSAIMoneyProtectionScreen />);
    await screen.findByTestId('mpx-monitoring');
    expect(screen.queryByTestId('mpx-notify-limits')).toBeNull();
  });
  it('explains Value Under Review: the plain sum vs counting overlapping alerts on the same transactions once', async () => {
    mc.summary.mockResolvedValue(SUM({ exposure: { alerts: 3, sumCents: 12500, groups: 2, dedupedCents: 9000, overlappingAlerts: 2, capped: false } }));
    wrap(<POSAIMoneyProtectionScreen />);
    const e = await screen.findByTestId('mpx-exposure');
    expect(e.textContent).toMatch(/3 open alerts add up to \$125\.00/);
    expect(screen.getByTestId('mpx-exposure-dedup').textContent).toMatch(/2 of them point at the same transactions.*\$90\.00/);
  });
  it('renders the cards, the under-review framing, kinds of open alerts and the detection runs', async () => {
    mc.summary.mockResolvedValue(SUM());
    wrap(<POSAIMoneyProtectionScreen />);
    expect(await screen.findByRole('heading', { name: 'AI Money Protection' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mpx-kpi-value')).toHaveTextContent('$125.00'));
    expect(screen.getByTestId('mpx-value-hint')).toHaveTextContent(/not a confirmed loss/i);
    expect(screen.getByTestId('mpx-bycat')).toHaveTextContent('Duplicate charges');
    expect(await screen.findByTestId('mpx-run-row')).toHaveTextContent('2 new · 1 refreshed');
    expect(screen.getByTestId('mpx-monitoring')).toHaveTextContent(/Monitoring is current/);
  });
  it('detection never ran: says so (never "nothing needs review"); Run detection now reports what it raised', async () => {
    mc.summary.mockResolvedValue(SUM({ cards: { newAlerts: 0, openAlerts: 0, critical: 0, high: 0, valueUnderReviewCents: 0, openInvestigations: 0, dismissed30d: 0 }, byCategory: {}, monitoring: 'never_checked', scheduled: false, lastSuccessAt: null }));
    mc.runDetection.mockResolvedValue({ status: 'succeeded', reused: false, created: 3, updated: 0 });
    wrap(<POSAIMoneyProtectionScreen />);
    expect(await screen.findByTestId('mpx-monitoring')).toHaveTextContent(/never run/);
    expect(screen.getByTestId('mpx-monitoring')).toHaveTextContent(/Scheduled detection is off/);
    expect(screen.queryByText(/Nothing needs review right now/)).toBeNull();
    fireEvent.click(screen.getByTestId('mpx-run'));
    expect(await screen.findByTestId('mpx-note')).toHaveTextContent('3 new alert(s)');
  });
  it('Check AI Money Protection System: localized checks with part and last pass; a refused check is an error', async () => {
    mc.summary.mockResolvedValue(SUM());
    mc.check.mockResolvedValueOnce({ overall: 'FAILED', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'detection_recent', component: 'detection', state: 'FAILED', lastPassedAt: null }] }).mockRejectedValueOnce({ status: 403 });
    wrap(<POSAIMoneyProtectionScreen />);
    fireEvent.click(await screen.findByTestId('mpx-check'));
    const k = await screen.findByTestId('mpx-chk-detection_recent');
    expect(k).toHaveTextContent('Detection ran recently'); expect(k).toHaveTextContent('Part: Detection'); expect(k).toHaveTextContent('Has not passed yet');
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByTestId('mpx-check'));
    expect(await screen.findByText(/cannot do this in Money Protection/)).toBeInTheDocument();
  });
});

describe('Money Protection overview — failure-aware snapshot (AI Money Protection 5 · extras #12)', () => {
  it('a failed refresh keeps the last figures labelled stale and "as of", never zeros; nothing ever read shows "—"', async () => {
    mc.summary.mockResolvedValueOnce(SUM());
    mc.runDetection.mockResolvedValue({ created: 0, updated: 0 });
    wrap(<POSAIMoneyProtectionScreen />);
    await waitFor(() => expect(screen.getByTestId('mpx-kpi-open')).toHaveTextContent('6'));
    expect(screen.queryByTestId('mpx-asof')).toBeNull();
    mc.summary.mockRejectedValueOnce(new Error('Failed to fetch'));
    fireEvent.click(screen.getByTestId('mpx-run'));
    expect(await screen.findByTestId('mpx-asof')).toHaveTextContent(/as of .+; they are not live/);
    expect(screen.getByTestId('mpx-kpi-open')).toHaveTextContent('6');
    mc.summary.mockResolvedValueOnce(SUM({ cards: { ...SUM().cards, openAlerts: 7 } }));
    fireEvent.click(screen.getByTestId('mpx-asof-retry'));
    await waitFor(() => expect(screen.queryByTestId('mpx-asof')).toBeNull());
    expect(screen.getByTestId('mpx-kpi-open')).toHaveTextContent('7');
  });
  it('a first read that fails is an error with "—" cards, not a stale label', async () => {
    mc.summary.mockRejectedValueOnce(new Error('Failed to fetch'));
    wrap(<POSAIMoneyProtectionScreen />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('mpx-asof')).toBeNull();
    expect(screen.getByTestId('mpx-kpi-open')).toHaveTextContent('—');
  });
});
