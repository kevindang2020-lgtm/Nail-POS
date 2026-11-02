// MobileVersionsScreen.test.tsx — BUILD_PLAN Phase 13 B (Constitution 6 §55–57, §150): Super Admin → System Operations →
// Mobile app versions. Every store app × platform is listed (configured or not), the installed-version distribution of the
// last 7 days with each version's state, and a policy edit that needs a reason and sends the optimistic version.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
import { api } from '../api/client';
import { MobileVersionsScreen } from './MobileVersionsScreen';

const STORE = 'https://apps.apple.com/app/id1';
const overview = {
  rows: [{ app: 'tech', platform: 'ios', minSupported: '1.4.0', recommended: '1.5.0', latest: '1.6.0', storeUrl: STORE, message: null, version: 3, updatedAt: '2026-10-09T10:00:00Z', updatedBy: null }],
  distribution: [
    { app: 'tech', platform: 'ios', version: '1.3.0', installs: 4, state: 'UPDATE_REQUIRED' },
    { app: 'tech', platform: 'ios', version: '1.6.0', installs: 20, state: 'SUPPORTED' },
  ],
  windowDays: 7, totals: { installs: 24, unsupported: 4, recommendedUpdate: 0 },
};
describe('Mobile app versions (§150)', () => {
  beforeEach(() => { vi.clearAllMocks(); (api.get as any).mockResolvedValue(overview); (api.put as any).mockResolvedValue({}); });

  it('lists all eight store app × platform policies, unconfigured ones say nothing is refused', async () => {
    render(<MobileVersionsScreen />);
    const policies = await screen.findByTestId('mv-policies');
    expect(within(policies).getAllByRole('row')).toHaveLength(1 + 8);
    expect(within(policies).getByText('1.4.0')).toBeTruthy();
    expect(within(policies).getAllByText(/not set — nothing refused/i).length).toBe(7);
  });

  it('shows the 7-day distribution with unsupported installs called out', async () => {
    render(<MobileVersionsScreen />);
    const dist = await screen.findByTestId('mv-distribution');
    expect(within(dist).getByText('1.3.0')).toBeTruthy();
    expect(within(dist).getByText('Update required')).toBeTruthy();
    expect(screen.getByText(/24 active installs/)).toBeTruthy();
    expect(screen.getByText(/4 on an unsupported version/)).toBeTruthy();
  });

  it('editing needs a reason of 10+ characters and sends the row version (optimistic lock)', async () => {
    render(<MobileVersionsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit tech ios' }));
    fireEvent.change(screen.getByLabelText('Minimum supported'), { target: { value: '1.5.0' } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'security fix shipped in 1.5.0' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/super-admin/mobile-versions/tech/ios', {
      minSupported: '1.5.0', recommended: '1.5.0', latest: '1.6.0', storeUrl: STORE, message: null, reason: 'security fix shipped in 1.5.0', expectedVersion: 3,
    }));
  });

  it('a failed read says so (never an empty list that looks like "no data")', async () => {
    (api.get as any).mockRejectedValue(new Error('down'));
    render(<MobileVersionsScreen />);
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });
});
