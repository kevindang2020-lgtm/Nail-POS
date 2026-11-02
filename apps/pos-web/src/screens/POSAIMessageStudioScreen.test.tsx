import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { draftMock } = vi.hoisted(() => ({ draftMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { generateDraft: draftMock, state: vi.fn(), previewAudience: vi.fn() } }));
import { POSAIMessageStudioScreen } from './POSAIMessageStudioScreen';
beforeEach(() => draftMock.mockReset());

function typeSalon(name = 'Lotus Nails') {
  fireEvent.change(screen.getByPlaceholderText('e.g. Lotus Nails'), { target: { value: name } });
}

describe('POSAIMessageStudioScreen', () => {
  it('generates a draft and shows validation warnings', async () => {
    draftMock.mockResolvedValue({
      channel: 'sms', text: 'Hi {{customer_first_name}}, book at {{salon_name}} {{booking_link}}',
      validation: { ok: false, requiresRevision: true, warnings: ['Draft appears to include a discount with no approved offer.'], usedTokens: ['customer_first_name', 'salon_name', 'booking_link'] },
      usage: { inputTokens: 12, outputTokens: 9, provider: 'mock', model: 'mock-1' }, hasApprovedOffer: false, generatedAt: 'now',
    });
    render(<POSAIMessageStudioScreen />);
    typeSalon();
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText('Needs revision')).toBeInTheDocument();
    expect(screen.getByText(/discount with no approved offer/i)).toBeInTheDocument();
    expect(screen.getByText('mock/mock-1 · 21 tokens')).toBeInTheDocument();
    expect(draftMock).toHaveBeenCalledOnce();
  });

  it('blocks generation and does not call the API when salon name is empty', async () => {
    render(<POSAIMessageStudioScreen />);
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText(/enter your salon name/i)).toBeInTheDocument();
    expect(draftMock).not.toHaveBeenCalled();
  });
});
