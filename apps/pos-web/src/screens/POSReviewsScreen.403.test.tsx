import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posReviewsApi', () => ({ posReviewsApi: { state: stateMock, setVisibility: vi.fn() } }));
import { POSReviewsScreen } from './POSReviewsScreen';
describe('Reviews permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSReviewsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
