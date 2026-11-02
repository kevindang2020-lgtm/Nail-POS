import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { previewMock } = vi.hoisted(() => ({ previewMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { previewAudience: previewMock, state: vi.fn(), generateDraft: vi.fn() } }));
import { POSAIAudienceBuilderScreen } from './POSAIAudienceBuilderScreen';

describe('Audience Builder permissions', () => {
  it('shows a permission message on 403', async () => {
    previewMock.mockRejectedValue({ status: 403 });
    render(<POSAIAudienceBuilderScreen />);
    fireEvent.click(screen.getByText('Estimate audience'));
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
