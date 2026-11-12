// Customer Notes extras (Nov 11 2026): nail-service quick chips; closing with unsaved edits asks first
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: {
  quickSearch: vi.fn(async () => ({ items: [{ customerId: 'c1', fullName: 'Grace Kim', phone: '', visitsCount: 2 }] })),
  getNotes: vi.fn(async () => ({ salonNotes: 'Likes almond shape', preferredStyle: 'Prefers nude tones' })),
  setNotes: vi.fn(),
} }));
import { POSCustomerNotesScreen, applyQuickNote, noteConflicts } from './POSCustomerNotesScreen';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

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

describe('Customer Profiles 06 — version check before saving notes', () => {
  it('someone else changed the notes meanwhile → nothing is written until Load theirs or Save mine anyway', async () => {
    const { posCustomersApi: api } = await import('../api/posCustomersApi') as any;
    api.setNotes.mockReset(); api.setNotes.mockImplementation(async (_id: string, n: any) => n);
    await openGrace();
    fireEvent.change(screen.getByTestId('cnx-ed-salonNotes'), { target: { value: 'Likes coffin shape' } });
    api.getNotes.mockResolvedValueOnce({ salonNotes: 'Likes almond shape', preferredStyle: 'Prefers nude tones', warnings: 'Latex allergy — added by Lan' });
    fireEvent.click(screen.getByTestId('cnx-ed-save'));
    expect(await screen.findByTestId('cnx-ed-conflict')).toBeInTheDocument();
    expect(api.setNotes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cnx-ed-save-anyway'));
    await waitFor(() => expect(api.setNotes).toHaveBeenCalledWith('c1', expect.objectContaining({ salonNotes: 'Likes coffin shape' })));
    expect(screen.queryByTestId('cnx-ed-conflict')).toBeNull();
  });
  it('Load theirs replaces the form with their version; an unchanged server saves straight away', async () => {
    const { posCustomersApi: api } = await import('../api/posCustomersApi') as any;
    api.setNotes.mockReset(); api.setNotes.mockImplementation(async (_id: string, n: any) => n);
    await openGrace();
    fireEvent.change(screen.getByTestId('cnx-ed-salonNotes'), { target: { value: 'Mine' } });
    api.getNotes.mockResolvedValueOnce({ salonNotes: 'Theirs', preferredStyle: 'Prefers nude tones' });
    fireEvent.click(screen.getByTestId('cnx-ed-save'));
    fireEvent.click(await screen.findByTestId('cnx-ed-load-theirs'));
    expect(screen.getByTestId('cnx-ed-salonNotes')).toHaveValue('Theirs');
    expect(api.setNotes).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('cnx-ed-salonNotes'), { target: { value: 'Theirs + mine' } });
    api.getNotes.mockResolvedValueOnce({ salonNotes: 'Theirs', preferredStyle: 'Prefers nude tones' });
    fireEvent.click(screen.getByTestId('cnx-ed-save'));
    await waitFor(() => expect(api.setNotes).toHaveBeenCalledWith('c1', expect.objectContaining({ salonNotes: 'Theirs + mine' })));
  });
});

describe('conflicting preferences (extras Customer Notes 6 · 02)', () => {
  const L = (k: string) => tx(k);
  it('two different values of one group across the preference fields are flagged with where each came from; one value, or "Squoval" vs "Oval", is not', () => {
    const c = noteConflicts({ preferredStyle: 'Shape: Almond\nPrefers nude tones', servicePreferences: 'Wants square tips, short length' }, L);
    expect(c).toEqual([{ group: 'Shape', hits: [{ value: 'Almond', field: 'preferredStyle' }, { value: 'Square', field: 'servicePreferences' }] }]);
    expect(noteConflicts({ preferredStyle: 'Shape: Almond', servicePreferences: 'almond again' }, L)).toEqual([]);
    expect(noteConflicts({ preferredStyle: 'Shape: Squoval', servicePreferences: '' }, L)).toEqual([]);
    expect(noteConflicts({ preferredStyle: 'Length: Short', servicePreferences: 'grow them long' }, L).map((x) => x.group)).toEqual(['Length']);
  });
  it('the editor shows the review note when a chip creates a conflict, and changes nothing else', async () => {
    await openGrace();
    expect(screen.queryByTestId('cnx-pref-conflict')).toBeNull();
    fireEvent.change(screen.getByTestId('cnx-ed-servicePreferences'), { target: { value: 'Square tips' } });
    fireEvent.click(screen.getByTestId('cnx-q-shape-almond'));
    const row = await screen.findByTestId('cnx-pref-conflict-row');
    expect(row).toHaveTextContent('Shape: Almond (Preferred Style) · Square (Service Preferences)');
    expect(screen.getByTestId('cnx-ed-servicePreferences')).toHaveValue('Square tips');
  });
});
