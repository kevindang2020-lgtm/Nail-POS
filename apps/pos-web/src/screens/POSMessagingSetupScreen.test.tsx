// POSMessagingSetupScreen.test — BUILD_PLAN Phase 4: the salon connects its Verify Service, tests it, disconnects, and
// gives a branch its own Twilio.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn(async () => ({ branches: [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Uptown' }] })) } }));
import { api } from '../api/client';
import { POSMessagingSetupScreen } from './POSMessagingSetupScreen';

const VA = 'VA' + 'a'.repeat(32);
const view = (over: Record<string, unknown> = {}) => ({ tenantId: 't1', branchId: null, provider: 'twilio', status: 'configured', accountSid: 'AC' + '1'.repeat(32), fromNumber: '+18565550100', authTokenLast4: 'abcd',
  verifyServiceSid: VA, apiKeySid: null, hasApiKeySecret: false, lastValidatedAt: null, lastValidationError: null, branchOverride: false, ...over });

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view(p.includes('/branches/b2') ? { branchId: 'b2' } : {}) : { configured: true, registeredNumber: '+18565550100' }) as never);
});

describe('Twilio Verify on the setup screen', () => {
  it('shows that Verify is untested, and "Test Verify" reports and reloads', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, friendlyName: 'My Salon' } as never);
    render(<POSMessagingSetupScreen />);
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Verify not tested yet');
    fireEvent.click(screen.getByText('Test Verify'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tenant/messaging/credentials/test-verify', {}));
    expect(await screen.findByTestId('verify-msg')).toHaveTextContent('Verify works — "My Salon"');
  });
  it('saves the Verify Service SID and an API key (secret write-only)', async () => {
    vi.mocked(api.put).mockResolvedValue(view({ apiKeySid: 'SK' + 'c'.repeat(32), hasApiKeySecret: true }) as never);
    render(<POSMessagingSetupScreen />);
    fireEvent.change(await screen.findByLabelText('API key SID'), { target: { value: 'SK' + 'c'.repeat(32) } });
    fireEvent.change(screen.getByLabelText('API key secret'), { target: { value: 'shh' } });
    fireEvent.click(screen.getByText('Save credentials'));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(vi.mocked(api.put).mock.calls[0]).toEqual(['/tenant/messaging/credentials', expect.objectContaining({ verifyServiceSid: VA, apiKeySid: 'SK' + 'c'.repeat(32), apiKeySecret: 'shh' })]);
    expect(await screen.findByText(/run "Test Verify"/)).toBeTruthy();
  });
  it('a failed test is shown with its reason', async () => {
    vi.mocked(api.get).mockImplementation(async (p: string) => (p.startsWith('/tenant/messaging/credentials') ? view({ lastValidationError: 'Twilio refused these credentials for this Verify Service.' }) : {}) as never);
    render(<POSMessagingSetupScreen />);
    expect(await screen.findByTestId('verify-status')).toHaveTextContent('Verify test failed: Twilio refused');
  });
  it('disconnect asks first', async () => {
    vi.mocked(api.del).mockResolvedValue({ ok: true } as never);
    render(<POSMessagingSetupScreen />);
    fireEvent.click(await screen.findByText('Disconnect'));
    expect(api.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Disconnect', { selector: '[role="dialog"] button, [role="alertdialog"] button' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/tenant/messaging/credentials'));
  });
  it('a branch that inherits says so; saving there creates its own', async () => {
    vi.mocked(api.put).mockResolvedValue(view({ branchId: 'b2', branchOverride: true }) as never);
    render(<POSMessagingSetupScreen />);
    fireEvent.change(await screen.findByLabelText('Branch'), { target: { value: 'b2' } });
    expect(await screen.findByText(/uses the salon’s Twilio/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Account SID'), { target: { value: 'AC' + '2'.repeat(32) } });
    fireEvent.change(screen.getByLabelText('Verify Service SID'), { target: { value: VA } });
    fireEvent.click(screen.getByText('Save credentials'));
    await waitFor(() => expect(vi.mocked(api.put).mock.calls[0][0]).toBe('/tenant/messaging/credentials/branches/b2'));
  });
});
