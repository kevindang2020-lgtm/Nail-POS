// POSCustomerNotesScreen.offline.test.tsx — Decision 33: saving notes while offline keeps them as a draft on this device
// (with the notes as loaded, for the reconnect check) and says so; a permission error is NOT turned into a draft.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const setNotesApi = vi.fn();
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: {
  quickSearch: vi.fn(async () => ({ items: [{ customerId: 'c1', fullName: 'Grace Kim', phone: '', visitsCount: 2 }] })),
  getNotes: vi.fn(async () => ({ salonNotes: 'Likes almond shape' })),
  setNotes: (...a: any[]) => setNotesApi(...a),
} }));
import { POSCustomerNotesScreen } from './POSCustomerNotesScreen';
import { listDrafts, setDraftScope } from '../api/offline-drafts';

beforeEach(() => { localStorage.clear(); setDraftScope('t1:b1:u1'); setNotesApi.mockReset(); });
const openGrace = async () => {
  render(<POSCustomerNotesScreen />);
  fireEvent.change(screen.getByPlaceholderText('Search by name, phone, or email…'), { target: { value: 'Grace' } });
  fireEvent.click(await screen.findByText('Grace Kim'));
  await screen.findByDisplayValue('Likes almond shape');
  fireEvent.change(screen.getByDisplayValue('Likes almond shape'), { target: { value: 'Likes almond shape. Gel sensitivity.' } });
};

describe('Customer Notes offline', () => {
  it('offline → saved as a draft (with the loaded notes as its base) and the screen says so', async () => {
    setNotesApi.mockRejectedValue(Object.assign(new Error('You are offline.'), { code: 'OFFLINE', status: 503 }));
    await openGrace();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/saved on this device as a draft/)).toBeInTheDocument();
    expect(listDrafts()).toEqual([expect.objectContaining({ targetId: 'c1', label: 'Grace Kim', payload: expect.objectContaining({ salonNotes: 'Likes almond shape. Gel sensitivity.' }), base: expect.objectContaining({ salonNotes: 'Likes almond shape' }) })]);
  });
  it('a permission error is shown as an error — not kept as a draft', async () => {
    setNotesApi.mockRejectedValue(Object.assign(new Error('You do not have permission to edit notes.'), { status: 403 }));
    await openGrace();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/You do not have permission to edit notes/)).toBeInTheDocument();
    expect(listDrafts()).toEqual([]);
  });
});
