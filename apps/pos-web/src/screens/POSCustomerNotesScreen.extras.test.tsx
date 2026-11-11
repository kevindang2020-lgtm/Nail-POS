// Customer Notes extras (Nov 11 2026): nail-service quick chips; closing with unsaved edits asks first
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: {
  quickSearch: vi.fn(async () => ({ items: [{ customerId: 'c1', fullName: 'Grace Kim', phone: '', visitsCount: 2 }] })),
  getNotes: vi.fn(async () => ({ salonNotes: 'Likes almond shape', preferredStyle: 'Prefers nude tones' })),
  setNotes: vi.fn(),
} }));
import { POSCustomerNotesScreen, applyQuickNote } from './POSCustomerNotesScreen';

const openGrace = async () => {
  render(<POSCustomerNotesScreen />);
  fireEvent.change(screen.getByPlaceholderText('Search by name, phone, or email…'), { target: { value: 'Grace' } });
  fireEvent.click(await screen.findByText('Grace Kim'));
  await screen.findByDisplayValue('Likes almond shape');
};
beforeEach(() => localStorage.clear());

describe('quick notes', () => {
  it('one line per group, a new pick replaces the old one, free text kept', () => {
    expect(applyQuickNote('Prefers nude tones', 'Shape', 'Almond')).toBe('Shape: Almond\nPrefers nude tones');
    expect(applyQuickNote('Shape: Almond\nPrefers nude tones', 'Shape', 'Coffin')).toBe('Shape: Coffin\nPrefers nude tones');
    expect(applyQuickNote('', 'Length', 'Short')).toBe('Length: Short');
  });
  it('a chip writes into Preferred style; closing then asks before discarding; Keep editing keeps the text', async () => {
    await openGrace();
    fireEvent.click(screen.getByTestId('cnx-q-shape-almond'));
    expect(screen.getByTestId('cnx-ed-preferredStyle')).toHaveValue('Shape: Almond\nPrefers nude tones');
    fireEvent.click(screen.getByTestId('cnx-ed-close'));
    expect(screen.getByTestId('cnx-ed-unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cnx-ed-keep'));
    expect(screen.getByTestId('cnx-ed-preferredStyle')).toHaveValue('Shape: Almond\nPrefers nude tones');
    fireEvent.click(screen.getByTestId('cnx-ed-close'));
    fireEvent.click(screen.getByTestId('cnx-ed-discard'));
    expect(screen.queryByTestId('cnx-editor')).toBeNull();
  });
  it('closing with nothing changed closes at once', async () => {
    await openGrace();
    fireEvent.click(screen.getByTestId('cnx-ed-close'));
    expect(screen.queryByTestId('cnx-editor')).toBeNull();
  });
});
