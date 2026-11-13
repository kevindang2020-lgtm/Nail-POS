// CustomerQuickView — round 10 (Customer Profile Assistant 03): each note on the Notes & Preferences tab shows where it came
// from and when it was last written — read from Customer Notes (its own source labels), never computed here; a role that may
// not read notes, or a failed read, shows the notes alone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ detail: vi.fn(), notes: vi.fn(), perms: { notes: true } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { getDetail: m.detail } }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: { summary: vi.fn(), customers: vi.fn() } }));
vi.mock('../api/posCustomerNotesApi', () => ({ posCustomerNotesApi: { detail: m.notes } }));
vi.mock('../components/usePermissions', async (o) => ({ ...(await o<typeof import('../components/usePermissions')>()), useCan: () => (k: string) => (k === 'pos.customers.notes.view' ? m.perms.notes : true) }));
import { CustomerQuickView } from '../components/CustomerProfilesDirectory';

const DETAIL = { displayName: 'Ana Rivera', status: 'active', visitCount: 3, loyalty: {}, membership: {}, giftCards: [], recentVisits: [],
  notes: { warnings: 'Avoid e-file', allergyNotes: 'Latex', preferredTechnician: 'Linh', servicePreferences: 'Short almond', salonNotes: 'Prefers mornings' } };
const NOTES = { customer: { id: 'c1', name: 'Ana', phone: null, customerVisible: false, updatedAt: null }, history: [], entries: [
  { category: 'allergy', text: 'Latex', hash: 'h1', at: '2026-11-02T15:00:00Z', ticketId: null, review: 'reviewed', reviewedAt: null, safety: true, provenance: { source: 'customer_reported', origin: 'labelled', setBy: 'Kim Desk', setAt: '2026-11-02T15:05:00Z', reference: null, earlierLabel: false } },
  { category: 'service_preference', text: 'Short almond', hash: 'h2', at: '2026-10-20T15:00:00Z', ticketId: null, review: 'not_required', reviewedAt: null, safety: false, provenance: { source: 'not_stated', origin: 'none', setBy: null, setAt: null, reference: null, earlierLabel: false } },
] };
beforeEach(() => { m.detail.mockReset(); m.notes.mockReset(); m.perms.notes = true; m.detail.mockResolvedValue(DETAIL); m.notes.mockResolvedValue(NOTES); });

describe('Quick View — per-preference provenance', () => {
  it('shows the source label, who labelled it and when the note was last written', async () => {
    render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana' } as never} onClose={() => {}} onFullView={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('cpx-tab-notes'));
    expect(await screen.findByTestId('cpx-prov-allergy')).toHaveTextContent('Customer-reported · Labelled by Kim Desk');
    expect(screen.getByTestId('cpx-prov-allergy')).toHaveTextContent('updated Nov 2, 2026');
    expect(screen.getByTestId('cpx-prov-service_preference')).toHaveTextContent('Source not stated');
    expect(screen.queryByTestId('cpx-prov-warning')).toBeNull();   // Customer Notes returned nothing for it — nothing invented
    expect(m.notes).toHaveBeenCalledWith('c1');
  });
  it('without permission to read notes, no extra read and no provenance lines', async () => {
    m.perms.notes = false;
    render(<MemoryRouter><CustomerQuickView customer={{ id: 'c1', name: 'Ana' } as never} onClose={() => {}} onFullView={() => {}} /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('cpx-tab-notes'));
    await waitFor(() => expect(screen.getByText('Latex')).toBeInTheDocument());
    expect(m.notes).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cpx-prov-allergy')).toBeNull();
  });
});
