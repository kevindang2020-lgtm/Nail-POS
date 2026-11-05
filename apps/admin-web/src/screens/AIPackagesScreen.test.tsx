// QA for the AI Packages screen incl. the round-13 per-feature toggles (spec §13): tier rendering, the Features
// panel with effective pills + inherited/forced state, and that On/Off/Inherit send the exact setAiFeature bodies.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { aiPackages: vi.fn(), setAiPackage: vi.fn(), setAiFeature: vi.fn(), usageLimits: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { AIPackagesScreen } from './AIPackagesScreen';

const allOn = { ai_receptionist: true, ai_booking: true, ai_customer_insights: true, ai_reports: true, ai_reminders: true, ai_workflow_assistant: true, voice_assistant: true };
const row = (over: any = {}) => ({ tenantId: 't1', tenantName: 'Glow Nail Spa', tenantCode: 'GLOW', tenantStatus: 'active', package: 'AI Pro', aiCallsLimit: 10000, aiCallsUsed: 1200, featureOverrides: {}, effectiveFeatures: { ...allOn }, ...over });

describe('AIPackagesScreen (spec §13 per-feature toggles)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the tenant with its tier and opens the Features panel with all seven features', async () => {
    (superAdminApi.aiPackages as any).mockResolvedValue([row()]);
    render(<MemoryRouter><AIPackagesScreen /></MemoryRouter>);
    expect(await screen.findByText('Glow Nail Spa')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Features' }));
    expect(await screen.findByText('AI Receptionist')).toBeInTheDocument();
    for (const label of ['AI Booking', 'AI Customer Insights', 'AI Reports', 'AI Reminders', 'AI Workflow Assistant', 'Voice Assistant']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('On')).not.toHaveLength(0); // effective pills
    expect(screen.getAllByText(/inherited/)).toHaveLength(7);
  });

  it('forcing a feature Off sends setAiFeature(tenantId, key, false) and reloads', async () => {
    (superAdminApi.aiPackages as any)
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row({ featureOverrides: { ai_receptionist: false }, effectiveFeatures: { ...allOn, ai_receptionist: false } })]);
    (superAdminApi.setAiFeature as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><AIPackagesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    const featureRow = (await screen.findByText('AI Receptionist')).closest('.row') as HTMLElement;
    fireEvent.click(within(featureRow).getByRole('button', { name: 'Off' }));
    await waitFor(() => expect(superAdminApi.setAiFeature).toHaveBeenCalledWith('t1', 'ai_receptionist', false));
    expect(await screen.findByText(/forced off/)).toBeInTheDocument();
  });

  it('Inherit reverts an override by sending null', async () => {
    (superAdminApi.aiPackages as any).mockResolvedValue([row({ featureOverrides: { ai_booking: false }, effectiveFeatures: { ...allOn, ai_booking: false } })]);
    (superAdminApi.setAiFeature as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><AIPackagesScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Features' }));
    const featureRow = (await screen.findByText('AI Booking')).closest('.row') as HTMLElement;
    expect(within(featureRow).getByText('Off', { selector: 'span.pill' })).toBeInTheDocument(); // effective pill reflects the override
    fireEvent.click(within(featureRow).getByRole('button', { name: 'Inherit' }));
    await waitFor(() => expect(superAdminApi.setAiFeature).toHaveBeenCalledWith('t1', 'ai_booking', null));
  });
});
