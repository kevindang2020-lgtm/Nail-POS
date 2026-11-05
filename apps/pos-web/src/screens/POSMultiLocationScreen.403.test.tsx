import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posMultiLocationApi', () => ({ posMultiLocationApi: { state: stateMock } }));
import { POSMultiLocationScreen } from './POSMultiLocationScreen';
describe('Multi-location permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSMultiLocationScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
