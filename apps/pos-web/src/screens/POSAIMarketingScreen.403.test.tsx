import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { mkMock } = vi.hoisted(() => ({ mkMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { state: mkMock, previewAudience: vi.fn() } }));
import { POSAIMarketingScreen } from './POSAIMarketingScreen';

describe('AI Marketing permissions', () => {
  it('shows a permission message on 403', async () => {
    mkMock.mockRejectedValue({ status: 403 });
    render(<POSAIMarketingScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
