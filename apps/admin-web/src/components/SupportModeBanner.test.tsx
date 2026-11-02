import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { mySupportSessions: vi.fn(), endSupportSession: vi.fn(), extendSupportSession: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SupportModeBanner } from './SupportModeBanner';

const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
describe('SUPPORT MODE banner (Constitution 7 §75)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('shows tenant, reason, scope and expiry for each live session; Exit ends it server-side and removes the line', async () => {
    (superAdminApi.mySupportSessions as any).mockResolvedValue([{ id: 's1', source: 'support_access', tenantId: 't1', tenantName: 'Belle Palace', reason: 'Booking issue', scope: 'READ_ONLY', startedAt: inMin(-5), expiresAt: inMin(25) }]);
    (superAdminApi.endSupportSession as any).mockResolvedValue({ ok: true });
    render(<SupportModeBanner />);
    const b = await screen.findByTestId('support-mode-banner');
    expect(b).toHaveTextContent('SUPPORT MODE');
    expect(b).toHaveTextContent('Belle Palace');
    expect(b).toHaveTextContent('Booking issue');
    expect(b).toHaveTextContent('Read only');
    expect(b).toHaveTextContent('Expires:');
    fireEvent.click(screen.getByRole('button', { name: 'Exit Support Mode' }));
    await waitFor(() => expect(superAdminApi.endSupportSession).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByTestId('support-mode-banner')).toBeNull());
  });
  it('renders nothing when there is no live session, and ignores an already-expired one', async () => {
    (superAdminApi.mySupportSessions as any).mockResolvedValue([{ id: 's2', source: 'view_pos', tenantId: 't1', tenantName: 'X', reason: 'old one', scope: 'READ_ONLY', startedAt: inMin(-90), expiresAt: inMin(-1) }]);
    render(<SupportModeBanner />);
    await waitFor(() => expect(superAdminApi.mySupportSessions).toHaveBeenCalled());
    expect(screen.queryByTestId('support-mode-banner')).toBeNull();
  });
  it('§78: Extend needs a reason, sends minutes + reason, and reloads the session', async () => {
    (superAdminApi.mySupportSessions as any).mockResolvedValue([{ id: 's3', source: 'support_access', tenantId: 't1', tenantName: 'Belle Palace', reason: 'Booking issue', scope: 'READ_ONLY', startedAt: inMin(-10), expiresAt: inMin(5) }]);
    (superAdminApi.extendSupportSession as any).mockResolvedValue({ ok: true });
    render(<SupportModeBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    const form = screen.getByTestId('support-extend');
    const go = screen.getByRole('button', { name: 'Extend access' });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Extend by minutes'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Extension reason'), { target: { value: 'still reproducing the booking bug' } });
    fireEvent.click(go);
    await waitFor(() => expect(superAdminApi.extendSupportSession).toHaveBeenCalledWith('s3', 30, 'still reproducing the booking bug'));
    await waitFor(() => expect((superAdminApi.mySupportSessions as any).mock.calls.length).toBeGreaterThan(1));
    expect(form).toBeTruthy();
  });
});
