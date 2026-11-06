import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { alertSummary: vi.fn(), rules: vi.fn(), history: vi.fn(), alertCheck: vi.fn(), anomaly: vi.fn(), incidents: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { center: c } }));
import { POSAiAlertsScreen } from './POSAiAlertsScreen';

describe('AI Business Alerts permissions', () => {
  it('shows a permission message on 403', async () => {
    for (const f of [c.alertSummary, c.rules, c.history, c.incidents]) f.mockRejectedValue({ status: 403 });
    render(<MemoryRouter><POSAiAlertsScreen /></MemoryRouter>);
    expect((await screen.findAllByText('Your role cannot use AI Business.')).length).toBeGreaterThan(0);
  });
});
