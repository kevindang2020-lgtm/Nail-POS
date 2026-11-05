// SystemOpsMobileTelemetry.test — BUILD_PLAN Phase 13 (C6 §116–119): the simple mobile count view on System Operations.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemMobileTelemetry: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SystemOpsMobileTelemetry } from './SystemOpsMobileTelemetry';

beforeEach(() => { vi.mocked(superAdminApi.systemMobileTelemetry).mockReset(); });

describe('SystemOpsMobileTelemetry', () => {
  it('one row per app + platform: events, errors, launch and API p95', async () => {
    vi.mocked(superAdminApi.systemMobileTelemetry).mockResolvedValue({
      scope: 'instance', generatedAt: '2026-10-09T12:00:00Z',
      apps: [{ app: 'tech', platform: 'android', events: { screen_viewed: 40, service_started_ui: 3 }, errors: 2,
        perf: { launch_to_first_screen: { count: 5, p50Ms: 900, p95Ms: 1800 }, api_latency: { count: 120, p50Ms: 140, p95Ms: 620 } } }],
    } as never);
    render(<SystemOpsMobileTelemetry />);
    const row = await screen.findByTestId('mobile-row-tech-android');
    expect(row).toHaveTextContent('tech');
    expect(row).toHaveTextContent('android');
    expect(row).toHaveTextContent('43');      // events
    expect(row).toHaveTextContent('2');       // errors
    expect(row).toHaveTextContent('1800 ms'); // launch p95
    expect(row).toHaveTextContent('620 ms');  // API p95
    expect(screen.getByText(/this API instance/i)).toBeTruthy();
  });
  it('empty: says so plainly', async () => {
    vi.mocked(superAdminApi.systemMobileTelemetry).mockResolvedValue({ scope: 'instance', generatedAt: 'x', apps: [] } as never);
    render(<SystemOpsMobileTelemetry />);
    expect(await screen.findByText('No mobile telemetry received yet.')).toBeTruthy();
  });
  it('an error is shown, not swallowed', async () => {
    vi.mocked(superAdminApi.systemMobileTelemetry).mockRejectedValue(new Error('Forbidden'));
    render(<SystemOpsMobileTelemetry />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });
});
