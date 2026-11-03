import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { draftMock } = vi.hoisted(() => ({ draftMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { generateDraft: draftMock, center: { estimate: vi.fn().mockResolvedValue({ channel: 'sms', characters: 40, encoding: 'GSM-7', segmentsPerMessage: 1, recipients: 100, estimatedSegments: 100, estimatedCostCents: 350, unresolved: [], costNote: 'estimate' }), check: vi.fn() } } }));
import { MemoryRouter } from 'react-router-dom';
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
    render(<MemoryRouter><POSAIMessageStudioScreen /></MemoryRouter>);
    typeSalon();
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText('Needs revision')).toBeInTheDocument();
    expect(screen.getByText(/discount with no approved offer/i)).toBeInTheDocument();
    expect(screen.getByText('mock/mock-1 · 21 tokens')).toBeInTheDocument();
    expect(draftMock).toHaveBeenCalledOnce();
    // Message Studio guide (Nov 3 2026): the edited text shows its segments and estimated cost, and carries to the Campaign Builder
    expect(await screen.findByTestId('amk-estimate')).toHaveTextContent('40 characters · GSM-7 · 1 segment(s) per text');
    expect(screen.getByTestId('amk-est-cost')).toHaveTextContent('Estimated cost $3.50 (100 segments)');
    expect(screen.getByTestId('amk-studio-use').getAttribute('href')).toContain('/tenant/ai/marketing/builder?channel=sms&message=Hi%20');
  });

  it('blocks generation and does not call the API when salon name is empty', async () => {
    render(<MemoryRouter><POSAIMessageStudioScreen /></MemoryRouter>);
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText(/enter your salon name/i)).toBeInTheDocument();
    expect(draftMock).not.toHaveBeenCalled();
  });
});
