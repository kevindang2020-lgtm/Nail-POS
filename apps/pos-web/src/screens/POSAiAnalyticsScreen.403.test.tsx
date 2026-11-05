import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { ovMock } = vi.hoisted(() => ({ ovMock: vi.fn() }));
vi.mock('../api/posAiCenterApi', () => ({ posAiCenterApi: { overview: ovMock } }));
import { POSAiAnalyticsScreen } from './POSAiAnalyticsScreen';
describe('AI analytics permissions', () => {
  it('shows a permission message on 403', async () => { ovMock.mockRejectedValue({ status: 403 }); render(<POSAiAnalyticsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
