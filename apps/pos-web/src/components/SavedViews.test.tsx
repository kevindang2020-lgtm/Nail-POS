import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SavedViews, viewableFilters } from './SavedViews';
import { posSavedViewsApi } from '../api/posSavedViewsApi';

vi.mock('../api/posSavedViewsApi', () => ({ posSavedViewsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));
const V = (id: string, name: string, filters: Record<string, unknown>, isDefault = false) => ({ id, surface: 'mp.alerts', name, filters, isDefault, updatedAt: '2026-11-09T00:00:00Z' });

describe('SavedViews (extras arc, Nov 9 2026)', () => {
  beforeEach(() => { vi.mocked(posSavedViewsApi.list).mockReset(); vi.mocked(posSavedViewsApi.create).mockReset(); vi.mocked(posSavedViewsApi.update).mockReset(); vi.mocked(posSavedViewsApi.remove).mockReset(); });

  it('applies my default view once when the screen opens', async () => {
    vi.mocked(posSavedViewsApi.list).mockResolvedValue({ surface: 'mp.alerts', limit: 20, items: [V('a', 'Critical', { severity: 'critical' }, true), V('b', 'Mine', { assignee: 'me' })] as any });
    const onApply = vi.fn();
    render(<SavedViews surface="mp.alerts" current={{}} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0]).toEqual({ severity: 'critical' });
    expect(posSavedViewsApi.list).toHaveBeenCalledWith('mp.alerts');
    expect(await screen.findByText(/Critical/)).toBeInTheDocument();
  });

  it('saves the current filters under a name, and applies a view from the list', async () => {
    vi.mocked(posSavedViewsApi.list).mockResolvedValue({ surface: 'mp.alerts', limit: 20, items: [V('b', 'Mine', { assignee: 'me' })] as any });
    vi.mocked(posSavedViewsApi.create).mockResolvedValue(V('c', 'Open high', { status: 'open' }) as any);
    const onApply = vi.fn();
    render(<SavedViews surface="mp.alerts" current={{ status: 'open', page: 3, fn: () => 1, nested: { a: 1 } }} onApply={onApply} />);
    await waitFor(() => expect(posSavedViewsApi.list).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();   // no default view → nothing applied on open
    fireEvent.click(screen.getByTestId('saved-views'));
    fireEvent.change(await screen.findByTestId('saved-views-name'), { target: { value: 'Open high' } });
    fireEvent.click(screen.getByTestId('saved-views-default'));
    fireEvent.click(screen.getByTestId('saved-views-save'));
    await waitFor(() => expect(posSavedViewsApi.create).toHaveBeenCalledWith({ surface: 'mp.alerts', name: 'Open high', filters: { status: 'open', page: 3 }, isDefault: true }));
    fireEvent.click((await screen.findAllByTestId('saved-views-apply'))[0]);
    expect(onApply).toHaveBeenLastCalledWith({ assignee: 'me' }, expect.objectContaining({ id: 'b' }));
  });

  it('shows the server refusal in words and keeps the dialog usable', async () => {
    vi.mocked(posSavedViewsApi.list).mockResolvedValue({ surface: 'mp.alerts', limit: 20, items: [] });
    vi.mocked(posSavedViewsApi.create).mockRejectedValue(Object.assign(new Error('You already have a saved view with that name on this screen.'), { status: 409, code: 'SAVED_VIEW_NAME_TAKEN' }));
    render(<SavedViews surface="mp.alerts" current={{ q: 'x' }} onApply={vi.fn()} />);
    fireEvent.click(screen.getByTestId('saved-views'));
    expect(await screen.findByTestId('saved-views-empty')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('saved-views-name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByTestId('saved-views-save'));
    expect(await screen.findByTestId('saved-views-error')).toHaveTextContent(/already have a saved view/);
  });

  it('viewableFilters keeps only text, numbers, yes/no, empty and text lists', () => {
    expect(viewableFilters({ a: 'x', b: 2, c: true, d: null, e: ['p', 'q'], f: undefined, g: { h: 1 }, i: [1, 2], j: Number.NaN })).toEqual({ a: 'x', b: 2, c: true, d: null, e: ['p', 'q'] });
  });
});
