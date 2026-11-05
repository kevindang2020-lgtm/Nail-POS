import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { searchMock, getMock, setMock } = vi.hoisted(() => ({ searchMock: vi.fn(), getMock: vi.fn(), setMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, getNotes: getMock, setNotes: setMock } }));
import { POSCustomerNotesScreen } from './POSCustomerNotesScreen';
beforeEach(() => { searchMock.mockReset(); getMock.mockReset(); setMock.mockReset(); });

const cust = { customerId: 'c1', fullName: 'Ana Rivera', phone: '555-1234', visitsCount: 7 };
const notes = { salonNotes: 'Prefers quiet', allergyNotes: 'Latex', preferredStyle: 'French', preferredTechnician: 'Ben', servicePreferences: 'Gel', warnings: 'Sensitive skin', customerVisible: false };

describe('POSCustomerNotesScreen', () => {
  it('searches, picks a customer, and loads their notes', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); getMock.mockResolvedValue(notes);
    render(<POSCustomerNotesScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('c1'));
    expect(await screen.findByRole('heading', { name: 'Ana Rivera' })).toBeInTheDocument();   // Sep 2026 redesign: the selected customer's name heads the notes panel
    expect(screen.getByDisplayValue('Sensitive skin')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Latex')).toBeInTheDocument();
  });
  it('saves edited notes', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); getMock.mockResolvedValue(notes); setMock.mockResolvedValue(notes);
    render(<POSCustomerNotesScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    await screen.findByRole('heading', { name: 'Ana Rivera' }); await screen.findByDisplayValue('Sensitive skin');
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));
    await waitFor(() => expect(setMock).toHaveBeenCalled());
    expect(setMock.mock.calls[0][0]).toBe('c1');
    expect(await screen.findByText(/Notes saved\./)).toBeInTheDocument();   // the redesign prefixes a check mark
  });
  it('surfaces a save error (e.g. no edit permission)', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); getMock.mockResolvedValue(notes); setMock.mockRejectedValue({ message: 'Forbidden' });
    render(<POSCustomerNotesScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    await screen.findByRole('heading', { name: 'Ana Rivera' }); await screen.findByDisplayValue('Sensitive skin');
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));
    expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
  });
});
