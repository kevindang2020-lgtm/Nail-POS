// AlertReadPanel.test — extras round 9 (AI BUSINESS ALERTS 05 / Global Loyalty Rewards 08): the bell's per-person unread alerts.
// "Mark read" posts MY read only (never the owner-alert acknowledge / resolve routes), re-reads the shell badges in this tab,
// tells my other tabs, and shows the alert's lifecycle state unchanged beside "Read".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../api/client', () => ({ api: m }));
import { AlertReadPanel } from './AlertReadPanel';

const A1 = '11111111-1111-4111-8111-111111111111', A2 = '22222222-2222-4222-8222-222222222222';
const at = new Date(Date.now() - 5 * 60_000).toISOString();
const list = (read1: string | null) => ({ generatedAt: at, unread: read1 ? 1 : 2, windowDays: 30, items: [
  { alertId: A1, category: 'loyalty', severity: 'warning', title: 'Token balance is low', lifecycleStatus: 'new', createdAt: at, readAt: read1 },
  { alertId: A2, category: 'ai_business_alert', severity: 'critical', title: 'Sales dropped', lifecycleStatus: 'acknowledged', createdAt: at, readAt: null },
] });

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); });

describe('Unread alerts in the bell (per person)', () => {
  it('lists my unread alerts with the alert lifecycle beside them and the read-vs-acknowledge note', async () => {
    m.get.mockResolvedValue(list(null));
    render(<AlertReadPanel />);
    expect(await screen.findByTestId('alert-reads-unread')).toHaveTextContent('2');
    expect(m.get).toHaveBeenCalledWith('/tenant/notifications/alerts', { limit: 10 });
    expect(screen.getByTestId('alert-read-' + A1)).toHaveTextContent(/Warning.*Token balance is low.*Rewards network · Alert: new/);
    expect(screen.getByTestId('alert-read-' + A2)).toHaveTextContent(/Critical.*Sales dropped.*Business alert · Alert: acknowledged/);
    expect(screen.getByTestId('alert-reads-note')).toHaveTextContent('does not acknowledge or fix the alert');
  });

  it('Mark read posts only my read, re-reads badges here and in my other tabs, and the alert stays "new"', async () => {
    m.get.mockResolvedValueOnce(list(null)).mockResolvedValueOnce(list(at));
    m.post.mockResolvedValue({ marked: 1, unread: 1, lifecycleChanged: false });
    const heard = vi.fn(); window.addEventListener('aps:nav-counts-changed', heard);
    const tabs: unknown[] = [];
    const other = typeof BroadcastChannel === 'function' ? new BroadcastChannel('aps-alert-reads') : null;
    if (other) other.onmessage = (e) => tabs.push(e.data);
    render(<AlertReadPanel />);
    fireEvent.click(await screen.findByTestId('alert-read-mark-' + A1));
    await waitFor(() => expect(screen.getByTestId('alert-read-state-' + A1)).toHaveTextContent('Read'));
    expect(m.post).toHaveBeenCalledTimes(1);
    expect(m.post).toHaveBeenCalledWith('/tenant/notifications/alerts/read', { alertIds: [A1] });
    expect(m.post.mock.calls.some(([u]) => String(u).includes('/owner/alerts'))).toBe(false);   // never the lifecycle routes
    expect(heard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('alert-read-' + A1)).toHaveTextContent('Alert: new');
    expect(screen.getByTestId('alert-reads-unread')).toHaveTextContent('1');
    if (other) { await waitFor(() => expect(tabs).toHaveLength(1)); other.close(); }
    window.removeEventListener('aps:nav-counts-changed', heard);
  });

  it('Mark all read sends only the unread ids shown; a failed load shows the error', async () => {
    m.get.mockResolvedValueOnce(list(null)).mockResolvedValueOnce(list(at));
    m.post.mockResolvedValue({ marked: 2, unread: 0, lifecycleChanged: false });
    const v = render(<AlertReadPanel />);
    fireEvent.click(await screen.findByTestId('alert-reads-all'));
    await waitFor(() => expect(m.post).toHaveBeenCalledWith('/tenant/notifications/alerts/read', { alertIds: [A1, A2] }));
    v.unmount();
    m.get.mockRejectedValueOnce(new Error('offline'));
    render(<AlertReadPanel />);
    await waitFor(() => expect(screen.getByTestId('alert-reads-error')).toHaveTextContent('offline'));
  });
});
