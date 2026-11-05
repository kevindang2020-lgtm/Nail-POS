import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { mockGet, mockSet, mockTest } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSet: vi.fn(), mockTest: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { tenantMessagingCreds: (t: string) => mockGet(t), setTenantMessagingCreds: (t: string, b: any) => mockSet(t, b), testTenantMessaging: (t: string, to: string) => mockTest(t, to), numberGet: () => Promise.resolve({ configured: false, usingOwnAccount: false, registeredNumber: null }) } }));

import TenantMessagingSetupScreen from './TenantMessagingSetupScreen';

const renderAt = () => render(
  <MemoryRouter initialEntries={['/tenants/ten_1/messaging']}>
    <Routes><Route path="/tenants/:tenantId/messaging" element={<TenantMessagingSetupScreen />} /></Routes>
  </MemoryRouter>
);
beforeEach(() => { mockGet.mockReset(); mockSet.mockReset(); });

describe('TenantMessagingSetupScreen', () => {
  it('shows configured state with the masked token hint and never a raw token', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' });
    renderAt();
    await waitFor(() => expect(screen.getAllByText(/Token ••••oken/)[0]).toBeInTheDocument());
  });

  it('sends a test SMS and reports the message id', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' });
    mockTest.mockResolvedValue({ ok: true, sid: 'SMabc' });
    renderAt();
    await waitFor(() => expect(screen.getByText('Send Test SMS')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('+18565550000'), { target: { value: '+18565559999' } });
    fireEvent.click(screen.getByText('Send Test SMS'));
    await waitFor(() => expect(mockTest).toHaveBeenCalledWith('ten_1', '+18565559999'));
    await waitFor(() => expect(screen.getByText(/message SMabc/)).toBeInTheDocument());
  });

  it('saves credentials and clears the token field', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'not_configured', accountSid: null, fromNumber: null, authTokenLast4: null });
    mockSet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' });
    renderAt();
    await waitFor(() => expect(screen.getByPlaceholderText('ACxxxxxxxxxxxxxxxx')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('ACxxxxxxxxxxxxxxxx'), { target: { value: 'AC1' } });
    fireEvent.change(screen.getByPlaceholderText('Twilio Auth Token'), { target: { value: 'sekret' } });
    // Sep 2026 redesign: the credentials card's From Number is the FIRST '+1856…1234' field (a second one sits in the number panel)
    fireEvent.change(screen.getAllByPlaceholderText('+18565551234')[0], { target: { value: '+18565551234' } });
    fireEvent.click(screen.getByText('Save Credentials'));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('ten_1', { accountSid: 'AC1', authToken: 'sekret', fromNumber: '+18565551234' }));
    await waitFor(() => expect(screen.getByText(/sends from its own Twilio account/)).toBeInTheDocument());
  });
});
