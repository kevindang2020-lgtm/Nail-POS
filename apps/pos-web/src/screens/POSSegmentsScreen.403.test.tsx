import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock, bySegmentMock } = vi.hoisted(() => ({ stateMock: vi.fn(), bySegmentMock: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { state: stateMock, bySegment: bySegmentMock } }));
import { POSSegmentsScreen } from './POSSegmentsScreen';
describe('Segments permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockResolvedValue({}); bySegmentMock.mockRejectedValue({ status: 403 }); render(<POSSegmentsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
