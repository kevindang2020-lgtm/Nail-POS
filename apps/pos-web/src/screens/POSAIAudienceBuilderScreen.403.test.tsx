import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { eligibility: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c } }));
import { POSAIAudienceBuilderScreen } from './POSAIAudienceBuilderScreen';

describe('Audience Builder permissions', () => {
  it('shows a permission message on 403', async () => {
    c.eligibility.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSAIAudienceBuilderScreen /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('amk-aud-rebooking'));
    expect(await screen.findByText('Your role cannot use marketing.')).toBeInTheDocument();
  });
});
