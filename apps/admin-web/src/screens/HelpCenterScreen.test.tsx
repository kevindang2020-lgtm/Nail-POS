import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    systemHealth: vi.fn().mockResolvedValue({ ok: true, database: { ok: true, latencyMs: 9 }, process: { uptimeSeconds: 7200, env: 'production' } }),
  },
}));

import { HelpCenterScreen } from './HelpCenterScreen';

describe('HelpCenterScreen (S23)', () => {
  it('renders help sections, live system status, and supports topic search', async () => {
    render(<MemoryRouter><HelpCenterScreen /></MemoryRouter>);
    expect(await screen.findByText('Help Center')).toBeInTheDocument();
    expect(screen.getByText('System Status')).toBeInTheDocument();
    // live system status from systemHealth
    expect(await screen.findByText(/All Systems Operational/i)).toBeInTheDocument();
    // curated help sections present
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('Security & compliance')).toBeInTheDocument();
    expect(screen.getByText('Which payment processors are supported?')).toBeInTheDocument();
    // honest gap
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(1);
    // functional client-side search narrows topics
    fireEvent.change(screen.getByPlaceholderText(/Search help topics/i), { target: { value: 'MFA' } });
    expect(screen.getByText(/How do I secure my own account/i)).toBeInTheDocument();
    expect(screen.queryByText('Which payment processors are supported?')).not.toBeInTheDocument();
  });
});
