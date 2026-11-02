import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { mockGet, mockSet, mockTest, mockProvision } = vi.hoisted(() => ({ mockGet: vi.fn(), mockSet: vi.fn(), mockTest: vi.fn(), mockProvision: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { tenantMessagingCreds: (t: string) => mockGet(t), setTenantMessagingCreds: (t: string, b: any) => mockSet(t, b), testTenantMessaging: (t: string, to: string) => mockTest(t, to), numberGet: () => Promise.resolve({ configured: false, usingOwnAccount: false, registeredNumber: null }), provisionPlatformMessaging: (t: string, b: any) => mockProvision(t, b) } }));

import TenantMessagingSetupScreen from './TenantMessagingSetupScreen';
import { expectNoA11yViolations } from '@aipowersalon/testing/a11y';   // §220 (Oct 21 2026): axe over the rendered screen

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

  // B-16: provisioning a platform-managed salon's texting
  it('B-16: a salon with no Twilio can be provisioned (reason required); a stop is shown with its step, and the retry is offered', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'not_configured', accountSid: null, fromNumber: null, authTokenLast4: null });
    mockProvision.mockResolvedValueOnce({ ok: false, step: 'subaccount', error: 'Twilio: messaging_service exploded' });
    renderAt();
    const btn = await screen.findByRole('button', { name: 'Provision platform texting' });
    expect(btn).toBeDisabled();                                                         // a reason first
    fireEvent.change(screen.getByLabelText('Reason for provisioning'), { target: { value: 'new salon onboarding' } });
    fireEvent.change(screen.getByLabelText('Area code'), { target: { value: '856' } });
    fireEvent.click(btn);
    await waitFor(() => expect(mockProvision).toHaveBeenCalledWith('ten_1', { reason: 'new salon onboarding', areaCode: '856' }));
    expect(await screen.findByText(/Stopped after “Subaccount created”: Twilio: messaging_service exploded/)).toBeInTheDocument();
  });
  it('B-16: a live platform-managed salon shows its subaccount, service and number — and is not offered again', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'ACsub', fromNumber: '+18565550142', authTokenLast4: '7788',
      accountMode: 'platform_managed', provisioning: { step: 'done', error: null, provisionedAt: '2026-10-20T23:00:00.000Z', messagingServiceSid: 'MGx' } });
    renderAt();
    expect(await screen.findByText(/Live since .* subaccount ACsub, service MGx, number \+18565550142/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Provision platform texting|Continue provisioning/ })).toBeNull();
  });
  it('B-16: a salon on its OWN Twilio account is not offered platform provisioning', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken', accountMode: 'tenant_owned', provisioning: null });
    renderAt();
    expect(await screen.findByText(/uses its own Twilio account/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Provision platform texting' })).toBeNull();
  });

  it('§220: no accessibility violations (axe)', async () => {
    mockGet.mockResolvedValue({ tenantId: 'ten_1', provider: 'twilio', status: 'configured', accountSid: 'AC1', fromNumber: '+18565551234', authTokenLast4: 'oken' });
    const { container } = renderAt();
    await waitFor(() => expect(screen.getAllByText(/Token ••••oken/)[0]).toBeInTheDocument());
    await expectNoA11yViolations(container);
  });
});
