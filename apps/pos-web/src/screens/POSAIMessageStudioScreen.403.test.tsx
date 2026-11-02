import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { draftMock } = vi.hoisted(() => ({ draftMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { generateDraft: draftMock, state: vi.fn(), previewAudience: vi.fn() } }));
import { POSAIMessageStudioScreen } from './POSAIMessageStudioScreen';

describe('Message Studio permissions', () => {
  it('shows a permission message on 403', async () => {
    draftMock.mockRejectedValue({ status: 403 });
    render(<POSAIMessageStudioScreen />);
    fireEvent.change(screen.getByPlaceholderText('e.g. Lotus Nails'), { target: { value: 'Lotus Nails' } });
    fireEvent.click(screen.getByText('Generate draft'));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
