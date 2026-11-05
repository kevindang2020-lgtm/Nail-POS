// OfflineDraftsPanel.test.tsx — Decision 33 reconnect: drafts are checked (signed in? record unchanged?) and a person
// applies or discards each; a conflict is shown, never silently overwritten; nothing shows while offline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const getNotes = vi.fn(); const setNotes = vi.fn(async () => ({}));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { getNotes: (...a: any[]) => getNotes(...a), setNotes: (...a: any[]) => (setNotes as any)(...a) } }));
vi.mock('../api/authApi', () => ({ authApi: { me: async () => ({ userId: 'u1' }) } }));
import { OfflineDraftsPanel } from './OfflineDraftsPanel';
import { saveDraft, setDraftScope, listDrafts } from '../api/offline-drafts';

const base = { salonNotes: 'Likes almond shape' };
beforeEach(() => { localStorage.clear(); setDraftScope('t1:b1:u1'); getNotes.mockReset(); setNotes.mockClear();
  saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'Grace Kim', payload: { salonNotes: 'Gel sensitivity' }, base }); });

describe('OfflineDraftsPanel', () => {
  it('nothing is shown (or sent) while offline', () => {
    render(<OfflineDraftsPanel online={false} />);
    expect(screen.queryByText(/saved on this device/)).toBeNull();
  });
  it('online: Review checks the draft; unchanged → Apply sends it and removes the draft', async () => {
    getNotes.mockResolvedValue({ ...base });
    render(<OfflineDraftsPanel online={true} />);
    expect(screen.getByText('1 note was saved on this device while offline.')).toBeInTheDocument();
    expect(setNotes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Review'));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(setNotes).toHaveBeenCalledWith('c1', { salonNotes: 'Gel sensitivity' }));
    expect(listDrafts()).toEqual([]);
  });
  it('changed on another device → shown as a conflict; Discard keeps the newer notes (nothing sent)', async () => {
    getNotes.mockResolvedValue({ salonNotes: 'Edited at the desk' });
    render(<OfflineDraftsPanel online={true} />);
    fireEvent.click(screen.getByText('Review'));
    expect(await screen.findByText('These notes were changed on another device since.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(setNotes).not.toHaveBeenCalled();
    expect(listDrafts()).toEqual([]);
  });
});
