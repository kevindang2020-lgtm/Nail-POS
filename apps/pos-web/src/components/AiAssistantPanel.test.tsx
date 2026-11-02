import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/posAiApi', () => ({ posAiApi: { packages: vi.fn(), invoke: vi.fn() } }));
import { posAiApi } from '../api/posAiApi';
import { AiAssistantPanel } from './AiAssistantPanel';

const accessible = { code: 'ai_checkout_upsell_assistant', name: 'AI Checkout + Upsell Assistant', description: 'd', usageUnit: 'calls', subscription: { status: 'active', usageLimit: 3000 }, used: 10, remainingUsage: 2990, accessible: true, lockReason: null, lockLabel: null, trialAvailable: false };
const locked = { ...accessible, subscription: null, accessible: false, lockReason: 'not_subscribed', lockLabel: 'Subscribe to unlock this AI assistant', trialAvailable: true };

describe('AiAssistantPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers the assistant and renders the result when accessible', async () => {
    (posAiApi.packages as any).mockResolvedValue({ packages: [accessible] });
    (posAiApi.invoke as any).mockResolvedValue({ ok: true, text: 'Add gel topcoat (+$12)', remainingUsage: 2989 });
    render(<AiAssistantPanel packageCode="ai_checkout_upsell_assistant" cta="Suggest upsells" />);
    const btn = await screen.findByText('Suggest upsells');
    expect(screen.getByText('2,990 calls left')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(await screen.findByText('Add gel topcoat (+$12)')).toBeInTheDocument();
    expect(posAiApi.invoke).toHaveBeenCalledWith('ai_checkout_upsell_assistant', expect.objectContaining({ action: 'invoke' }));
  });

  it('renders a locked panel and never calls the model when not subscribed', async () => {
    (posAiApi.packages as any).mockResolvedValue({ packages: [locked] });
    render(<AiAssistantPanel packageCode="ai_checkout_upsell_assistant" cta="Suggest upsells" />);
    expect(await screen.findByText('Subscribe to unlock this AI assistant')).toBeInTheDocument();
    expect(screen.queryByText('Suggest upsells')).not.toBeInTheDocument();
    expect(posAiApi.invoke).not.toHaveBeenCalled();
  });

  it('renders nothing if the package is unknown to this tenant', async () => {
    (posAiApi.packages as any).mockResolvedValue({ packages: [] });
    const { container } = render(<AiAssistantPanel packageCode="ai_checkout_upsell_assistant" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
