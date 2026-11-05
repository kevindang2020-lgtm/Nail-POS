import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiProviderModal } from './AiUsageConfigProvider';

const saveAiProvider = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { saveAiProvider: (...a: any[]) => saveAiProvider(...a) } }));

describe('AiProviderModal', () => {
  beforeEach(() => { saveAiProvider.mockReset(); saveAiProvider.mockResolvedValue({ ok: true, provider: { id: 'AIPRV-0001', providerKey: 'openai', displayName: 'OpenAI', status: 'active', defaultModel: 'GPT-4.1', apiKeyMasked: 'sk_live_••••••••9X4K', apiKeyFingerprint: 'a1b2c3d4e5f6', hasKey: true, lastSyncAt: null } }); });

  it('requires provider, name, and key when adding', () => {
    render(<AiProviderModal onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Save provider'));
    expect(screen.getByText(/A display name is required/)).toBeInTheDocument();
    expect(screen.getByText(/An API key is required/)).toBeInTheDocument();
    expect(saveAiProvider).not.toHaveBeenCalled();
  });

  it('submits the key and surfaces only the returned mask (never the plaintext)', async () => {
    const onSaved = vi.fn();
    render(<AiProviderModal onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'OpenAI' } });
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: 'sk_live_realsecret9X4K' } });
    fireEvent.click(screen.getByText('Save provider'));
    await waitFor(() => expect(saveAiProvider).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'openai', apiKey: 'sk_live_realsecret9X4K' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/never displayed again/)));
    expect(onSaved.mock.calls[0][0]).toContain('sk_live_••••••••9X4K'); // mask shown
    expect(onSaved.mock.calls[0][0]).not.toContain('realsecret');       // plaintext never echoed
  });

  it('allows updating an existing provider without a key (blank = unchanged)', async () => {
    render(<AiProviderModal existing={{ id: 'AIPRV-0001', providerKey: 'openai', displayName: 'OpenAI', status: 'active', defaultModel: 'GPT-4.1', apiKeyMasked: 'sk_live_••••••••9X4K', apiKeyFingerprint: 'a1b2c3d4e5f6', hasKey: true, lastSyncAt: null }} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByText('Save provider'));
    await waitFor(() => expect(saveAiProvider).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'openai', apiKey: undefined })));
  });
});
