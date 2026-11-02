import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getDetail = vi.fn();
const appointments = vi.fn();
const getNotes = vi.fn();
vi.mock('../api/posCustomersApi', () => ({
  posCustomersApi: { getDetail: (...a: any[]) => getDetail(...a), appointments: (...a: any[]) => appointments(...a), getNotes: (...a: any[]) => getNotes(...a) },
}));

import { CustomerDetailInner } from './CustomerDetailInner';

const detail = {
  customerId: 'c1', displayName: 'Grace Kim', phone: '(555) 111-2222', email: 'grace@example.com',
  visitCount: 12, lastVisitAt: '2026-04-01', totalSpendCents: 120000, averageSpendCents: 10000,
  loyaltyPoints: 1500, loyaltyTier: 'Gold', isVip: true, tags: ['Regular'], smsOptIn: true, emailOptIn: false, marketingOptIn: true,
};

beforeEach(() => {
  getDetail.mockReset(); appointments.mockReset(); getNotes.mockReset();
  getDetail.mockResolvedValue(detail);
  appointments.mockResolvedValue({ items: [{ appointmentId: 'a1', serviceSummary: 'Gel Manicure', technicianName: 'Mia', startTime: '2026-04-01' }] });
  // the server's real notes shape (customers.setNotes / getNotes: salonNotes, allergyNotes, …) — the old { notes } mock
  // matched a flattening helper that never saw real data; the developer's view reads the real fields
  getNotes.mockResolvedValue({ salonNotes: 'Prefers window seat' });
});

describe('CustomerDetailInner (iPad customer view — real data)', () => {
  it('loads the real profile, contact, loyalty, spend, appointments and notes', async () => {
    render(<CustomerDetailInner customerId="c1" />);
    await waitFor(() => expect(screen.getByText('Gold')).toBeTruthy());
    expect(getDetail).toHaveBeenCalledWith('c1');
    expect(screen.getByText(/grace@example.com/)).toBeTruthy();
    expect(screen.getByText('1,500 points')).toBeTruthy();
    expect(screen.getByText('$1,200.00')).toBeTruthy(); // lifetime
    expect(screen.getByText('$100.00')).toBeTruthy();    // avg ticket
    expect(screen.getByText('Gel Manicure')).toBeTruthy();
    expect(screen.getByText(/Prefers window seat/)).toBeTruthy();
  });

  it('fails open: a notes-permission denial hides notes but the profile still renders', async () => {
    getNotes.mockRejectedValueOnce(new Error('forbidden'));
    render(<CustomerDetailInner customerId="c1" />);
    await waitFor(() => expect(screen.getByText('Gold')).toBeTruthy());
    expect(screen.queryByText(/Prefers window seat/)).toBeNull();
  });

  it('shows an error state when the profile itself fails to load', async () => {
    getDetail.mockRejectedValueOnce(new Error('nope'));
    render(<CustomerDetailInner customerId="c1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  // Decision 1: preferred name / language are profile fields — shown even when notes are not visible to this person.
  it('shows the preferred name and language from the profile even when notes are refused', async () => {
    getDetail.mockResolvedValue({ ...detail, preferredName: 'Gigi', preferredLanguage: 'Korean' });
    getNotes.mockRejectedValue(Object.assign(new Error('Missing pos.customers.notes.view'), { status: 403 }));
    render(<CustomerDetailInner customerId="c1" />);
    expect(await screen.findByText(/Gigi/)).toBeInTheDocument();
    expect(screen.getByText(/Korean/)).toBeInTheDocument();
  });
});
