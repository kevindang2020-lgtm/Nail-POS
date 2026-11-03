import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { draftMock } = vi.hoisted(() => ({ draftMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { generateDraft: draftMock, center: { estimate: vi.fn().mockResolvedValue({ channel: 'sms', characters: 40, encoding: 'GSM-7', segmentsPerMessage: 1, recipients: 100, estimatedSegments: 100, estimatedCostCents: 350, unresolved: [], costNote: 'estimate' }), check: vi.fn() } } }));
import { MemoryRouter } from 'react-router-dom';
import { POSAIMessageStudioScreen } from './POSAIMessageStudioScreen';

describe('Message Studio permissions', () => {
  it('shows a permission message on 403', async () => {
    draftMock.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSAIMessageStudioScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('e.g. Lotus Nails'), { target: { value: 'Lotus Nails' } });
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
