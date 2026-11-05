import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { m } = vi.hoisted(() => ({ m: { terminals: vi.fn() } }));
vi.mock('../api/posDevicesApi', () => ({ posDevicesApi: m }));
import { POSPaymentTerminalsScreen } from './POSPaymentTerminalsScreen';
describe('Payment terminals permissions', () => {
  it('shows a permission message on 403', async () => { m.terminals.mockRejectedValue({ status: 403 }); render(<POSPaymentTerminalsScreen />); expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument(); });
});
