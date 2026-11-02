// The sidebar's System Status card must never keep claiming "All Systems Operational" when the health
// check itself cannot be reached — an unreachable status endpoint IS a system problem.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../api/client';
import { useSystemStatus } from './tenant-access';

function Probe() {
  const s = useSystemStatus();
  return <div data-testid="s">{s.healthy ? 'ok' : 'bad'}:{s.label}</div>;
}

describe('useSystemStatus honesty', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows the real backend health when the endpoint answers', async () => {
    (api.get as any).mockResolvedValue({ healthy: false, label: 'Service degraded', version: 'v9' });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('bad:Service degraded'));
  });

  it('degrades to "Status unavailable" when the health check itself is unreachable — never stays green', async () => {
    (api.get as any).mockRejectedValue(new Error('network down'));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('bad:Status unavailable'));
  });
});
