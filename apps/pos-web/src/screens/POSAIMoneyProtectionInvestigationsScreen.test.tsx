// POSAIMoneyProtectionInvestigationsScreen — investigations (guides of Nov 3 2026): a server list (status, severity, which date, presets,
// pages), a case opens with its append-only timeline (notes + recorded decisions), notes are appended, a resolution is recorded.
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

import { POSAIMoneyProtectionInvestigationsScreen } from './POSAIMoneyProtectionInvestigationsScreen';
const inv = { id: 'inv1', title: 'Double card capture on T-1042', category: 'general', severity: 'CRITICAL', status: 'INVESTIGATING', assignee: null, branch: 'Main', valueUnderReviewCents: 5000,
  recoveryCents: 0, resolution: null, alerts: 1, notes: 1, openedAt: '2026-11-03T05:00:00Z', updatedAt: '2026-11-03T06:00:00Z', closedAt: null };
const TL = { items: [{ kind: 'event', action: 'status_changed', from: 'OPEN', to: 'INVESTIGATING', actor: 'Owner Kim', at: '2026-11-03T06:00:00Z' }, { kind: 'note', text: 'Called the processor', actor: 'Owner Kim', at: '2026-11-03T05:30:00Z' },
  { kind: 'event', action: 'opened', to: 'OPEN', actor: 'Owner Kim', at: '2026-11-03T05:00:00Z' }], alerts: [{ id: 'a1', ruleId: 'MP_DUP_CHARGE_EXACT', severity: 'CRITICAL', amountCents: 5000, status: 'INVESTIGATING' }] };
beforeEach(() => { vi.clearAllMocks(); mc.investigations.mockResolvedValue(page([inv])); mc.timeline.mockResolvedValue(TL); api.addNote.mockResolvedValue({}); api.resolveInvestigation.mockResolvedValue({}); });

describe('POSAIMoneyProtectionInvestigationsScreen', () => {
  it('lists active cases (unassigned flagged) and opens the append-only timeline; adds a note', async () => {
    wrap(<POSAIMoneyProtectionInvestigationsScreen />);
    const r = await screen.findByTestId('mpx-inv-row');
    expect(r).toHaveTextContent('Double card capture'); expect(r).toHaveTextContent('Unassigned'); expect(r).toHaveTextContent('1 alert(s) · 1 note(s)');
    expect(mc.investigations).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active', sort: 'updated', page: 1 }));
    fireEvent.click(screen.getByTestId('mpx-inv-view'));
    const items = await screen.findAllByTestId('mpx-tl-item');
    expect(items.map((x) => x.textContent)).toEqual([expect.stringContaining('Status changed'), expect.stringContaining('Called the processor'), expect.stringContaining('Opened')]);
    fireEvent.change(screen.getByTestId('mpx-note-text'), { target: { value: 'Bank shows two settlements' } });
    fireEvent.click(screen.getByTestId('mpx-add-note'));
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith('inv1', 'Bank shows two settlements'));
  });
  it('records a resolution (with recovered amount in cents)', async () => {
    wrap(<POSAIMoneyProtectionInvestigationsScreen />);
    fireEvent.click(await screen.findByTestId('mpx-inv-view'));
    fireEvent.change(await screen.findByTestId('mpx-resolution'), { target: { value: 'DUPLICATE_CHARGE_CONFIRMED' } });
    fireEvent.change(screen.getByTestId('mpx-recovery'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('mpx-resolve'));
    await waitFor(() => expect(api.resolveInvestigation).toHaveBeenCalledWith('inv1', 'DUPLICATE_CHARGE_CONFIRMED', 5000));
  });
  it('shows an empty state; filters reach the server', async () => {
    mc.investigations.mockResolvedValue(page([]));
    wrap(<POSAIMoneyProtectionInvestigationsScreen />);
    expect(await screen.findByText('No investigations here.')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('mpx-istatus'), { target: { value: 'RESOLVED' } });
    await waitFor(() => expect(mc.investigations).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RESOLVED', page: 1 })));
  });
  it('Reviewer workload: active / high / unassigned / aging counts for ALL active cases; High narrows the list', async () => {
    mc.investigations.mockResolvedValue({ ...page([inv]), workload: { open: 5, high: 2, unassigned: 3, aging: 1 } });
    wrap(<POSAIMoneyProtectionInvestigationsScreen />);
    expect(await screen.findByTestId('mpx-wl-open')).toHaveTextContent('5');
    expect(screen.getByTestId('mpx-wl-unassigned')).toHaveTextContent('3');
    expect(screen.getByTestId('mpx-wl-aging')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('mpx-wl-high'));
    await waitFor(() => expect(mc.investigations).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active', severity: 'HIGH' })));
  });
});
