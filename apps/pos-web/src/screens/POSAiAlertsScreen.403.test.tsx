import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { alertsList: listMock } }));
import { POSAiAlertsScreen } from './POSAiAlertsScreen';

describe('AI Alerts permissions', () => {
  it('shows a permission message on 403', async () => {
    listMock.mockRejectedValue({ status: 403 });
    render(<POSAiAlertsScreen />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
