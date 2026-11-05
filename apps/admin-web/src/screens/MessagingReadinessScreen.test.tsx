import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { messagingReadiness: () => h.get(), aiReadiness: () => Promise.resolve({ overall: "not_configured", provider: null, draftsPolished: false, checks: [{ key: "drafts", label: "Copilot draft polish", ok: false, detail: "Off — drafts use the built-in templates until a provider key is set" }], copilotPackage: { code: "ai_reception_copilot", name: "AI Reception Copilot", available: true } }) } }));
import MessagingReadinessScreen from './MessagingReadinessScreen';

beforeEach(() => h.get.mockReset());

describe('MessagingReadinessScreen', () => {
  it('renders the overall state, the checklist, and the webhook URLs (no secret values)', async () => {
    h.get.mockResolvedValue({
      overall: 'partial',
      checks: [
        { key: 'account_sid', label: 'Twilio Account SID', ok: true, required: true, detail: 'Set' },
        { key: 'vault_kek', label: 'Per-tenant credential encryption key', ok: false, required: false, detail: 'Too short (10 chars) — PROVIDER_VAULT_KEK must be ≥32' },
      ],
      webhooks: { inbound: 'https://api.x.com/webhooks/twilio/sms/inbound', status: 'https://api.x.com/webhooks/twilio/sms/status' },
    });
    render(<MessagingReadinessScreen />);
    await waitFor(() => expect(screen.getByText('Partially configured')).toBeInTheDocument());
    expect(screen.getByText('Twilio Account SID')).toBeInTheDocument();
    expect(screen.getByText(/must be ≥32/)).toBeInTheDocument();
    expect(screen.getByText('https://api.x.com/webhooks/twilio/sms/inbound')).toBeInTheDocument();
  });
});
