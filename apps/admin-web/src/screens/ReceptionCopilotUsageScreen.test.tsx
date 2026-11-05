import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockUsage } = vi.hoisted(() => ({ mockUsage: vi.fn() }));
vi.mock('../api/superAdminAiApi', () => ({ superAdminAiApi: { copilotUsage: () => mockUsage() } }));

import ReceptionCopilotUsageScreen from './ReceptionCopilotUsageScreen';

const renderScreen = () => render(<MemoryRouter initialEntries={['/reception-copilot']}><ReceptionCopilotUsageScreen /></MemoryRouter>);
beforeEach(() => { mockUsage.mockReset(); });

describe('ReceptionCopilotUsageScreen', () => {
  it('renders the total and per-action / per-tenant breakdowns', async () => {
    mockUsage.mockResolvedValue({
      available: true, window: { from: null, to: null }, total: 12,
      byAction: [{ action: 'appointment.created', count: 7 }, { action: 'message.sent', count: 5 }],
      byTenant: [{ tenantId: 'ten_abc', count: 8 }, { tenantId: 'ten_def', count: 4 }],
    });
    renderScreen();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('Appointment Created')).toBeInTheDocument();
    expect(screen.getByText('Message Sent')).toBeInTheDocument();
    expect(screen.getByText('ten_abc')).toBeInTheDocument();
  });

  it('shows an honest not-available state instead of fabricating numbers', async () => {
    mockUsage.mockResolvedValue({ available: false, window: { from: null, to: null }, total: 0, byAction: [], byTenant: [] });
    renderScreen();
    await waitFor(() => expect(screen.getByText(/isn.t available in this environment/i)).toBeInTheDocument());
  });
});
