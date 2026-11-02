import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posTimeClockApi', () => ({ posTimeClockApi: { state: stateMock, clockIn: vi.fn(), clockOut: vi.fn() } }));
import { POSTimeClockScreen } from './POSTimeClockScreen';
describe('Time clock permissions', () => {
  it('shows a permission message on 403', async () => { stateMock.mockRejectedValue({ status: 403 }); render(<POSTimeClockScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
