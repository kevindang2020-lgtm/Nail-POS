// Project Status: reads GET /super-admin/project-status/pos-settings ({ parent, sections }), rolls up section counts into
// KPIs, renders the per-module readiness flags, and re-runs a module check via PATCH .../recheck.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { projectStatus: vi.fn(), recheckModule: vi.fn() } }));

import { superAdminApi } from '../api/superAdminApi';
import { ProjectStatusScreen } from './ProjectStatusScreen';

const mod = (over: any = {}) => ({
  moduleKey: 'm', label: 'Module', route: '/pos/x', completionPercent: 100, status: 'Complete', missingReasons: [],
  frontendRouteExists: true, frontendComponentExists: true, backendEndpointExists: true, apiClientConnected: true, clicksWorking: true, testsPassing: true, ...over,
});

const payload = {
  parent: mod({ moduleKey: 'aipowersalon-pos-settings', label: 'POS Settings', completionPercent: 75, status: 'In Progress', testsPassing: false }),
  sections: [
    mod({ moduleKey: 'mod-business', label: 'Business & Branch', status: 'Complete', completionPercent: 100 }),
    mod({ moduleKey: 'mod-tips', label: 'Tips', status: 'Needs Review', completionPercent: 60, testsPassing: false }),
    mod({ moduleKey: 'mod-pay', label: 'Payments', status: 'Blocked', completionPercent: 0, backendEndpointExists: false, missingReasons: ['endpoint missing'], goLivePending: ['pair a terminal'] }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.projectStatus as any).mockResolvedValue(payload);
  (superAdminApi.recheckModule as any).mockResolvedValue(payload);
});

const kpi = (label: string) => within(screen.getByText(label, { selector: '.l' }).closest('.kpi') as HTMLElement);
const renderScreen = () => render(<MemoryRouter><ProjectStatusScreen /></MemoryRouter>);

describe('ProjectStatusScreen', () => {
  it('rolls up section counts into KPIs', async () => {
    renderScreen();
    expect(await screen.findByText('Business & Branch')).toBeInTheDocument();
    expect(kpi('Overall').getByText('75%')).toBeInTheDocument();
    expect(kpi('Sections').getByText('3')).toBeInTheDocument();
    expect(kpi('Complete').getByText('1')).toBeInTheDocument();                  // mod-business
    expect(kpi('In Progress / Review').getByText('1')).toBeInTheDocument();      // mod-tips (Needs Review)
    expect(kpi('Blocked / Not Started').getByText('1')).toBeInTheDocument();     // mod-pay
  });

  it('renders module readiness details (missing reasons, go-live pending)', async () => {
    renderScreen();
    await screen.findByText('Payments');
    expect(screen.getByText(/endpoint missing/)).toBeInTheDocument();
    expect(screen.getByText(/pair a terminal/)).toBeInTheDocument();
  });

  it('re-runs a module check via the real recheck route', async () => {
    renderScreen();
    await screen.findByText('Business & Branch');
    fireEvent.click(screen.getAllByText('Recheck')[0]);                          // first module = mod-business
    await waitFor(() => expect(superAdminApi.recheckModule).toHaveBeenCalledWith('mod-business'));
  });

  it('surfaces a load error', async () => {
    (superAdminApi.projectStatus as any).mockRejectedValue(new Error('status unavailable'));
    renderScreen();
    expect(await screen.findByText('status unavailable')).toBeInTheDocument();
  });
});
