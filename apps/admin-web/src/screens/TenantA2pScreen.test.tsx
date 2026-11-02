import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => ({ get: vi.fn(), brand: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { a2pGet: (t: string) => h.get(t), a2pSubmitBrand: (t: string) => h.brand(t), a2pSaveInputs: vi.fn(), a2pSubmitCampaign: vi.fn(), a2pAttachNumber: vi.fn(), a2pRefresh: vi.fn(), a2pSaveBusinessInfo: vi.fn(), a2pProvisionProfile: vi.fn() } }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { state: vi.fn().mockResolvedValue({ tenants: [] }) } }));

import TenantA2pScreen from './TenantA2pScreen';

const renderAt = () => render(<MemoryRouter initialEntries={['/tenants/ten_1/a2p']}><Routes><Route path="/tenants/:tenantId/a2p" element={<TenantA2pScreen />} /></Routes></MemoryRouter>);
beforeEach(() => { h.get.mockReset(); h.brand.mockReset(); });

describe('TenantA2pScreen', () => {
  it('shows the not-configured state and the progress steps', async () => {
    h.get.mockResolvedValue({ tenantId: 'ten_1', configured: false, status: 'not_started', brandSid: null, brandStatus: null, messagingServiceSid: null, campaignSid: null, campaignStatus: null, numberSid: null, isMock: true, lastError: null, inputs: { customerProfileBundleSid: null, a2pProfileBundleSid: null, brandType: 'STANDARD', campaignUsecase: 'MIXED' } });
    renderAt();
    await waitFor(() => expect(screen.getByText(/ISV Twilio account not configured/)).toBeInTheDocument());
    expect(screen.getByText('Brand submitted')).toBeInTheDocument();
  });

  it('surfaces the honest error when submitting a brand without ISV credentials', async () => {
    h.get.mockResolvedValue({ tenantId: 'ten_1', configured: false, status: 'not_started', brandSid: null, isMock: true, lastError: null, inputs: {} });
    h.brand.mockResolvedValue({ tenantId: 'ten_1', configured: false, status: 'not_started', brandSid: null, lastError: 'ISV Twilio credentials not configured (set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).', inputs: {} });
    renderAt();
    await waitFor(() => expect(screen.getByText('Submit Brand')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Submit Brand'));
    await waitFor(() => expect(screen.getByText(/credentials not configured/)).toBeInTheDocument());
  });
});
