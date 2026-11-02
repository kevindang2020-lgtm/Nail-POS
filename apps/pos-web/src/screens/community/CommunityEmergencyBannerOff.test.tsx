// CommunityEmergencyBannerOff.test.tsx — BUILD_PLAN Phase 12 (found by the /api/v1 browser check): a salon that is not in
// the Safety Community got a 403 community_disabled from GET /community/alerts/active on EVERY POS screen, every minute.
// The banner now reads the salon's community settings first (200 with `enabled`, same permission) and never asks for
// alerts while the community is off — not even once. A realtime 'community' push (the salon turning it on) re-checks.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const hooks: { onRefetch?: (reason?: any) => unknown } = {};
const activeAlerts = vi.fn();
const settings = vi.fn();
vi.mock('../../realtime/useRealtime', () => ({ useRealtime: (_s: any, fn: any) => { hooks.onRefetch = fn; } }));
vi.mock('../../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ principal: { role: 'OWNER', userId: 'u1' } }) }));
vi.mock('../../api/posCommunityApi', async (orig) => ({ ...(await orig() as any), posCommunityApi: { activeAlerts: () => activeAlerts(), settings: () => settings() } }));

import { CommunityEmergencyBanner } from './CommunityEmergencyBanner';
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('emergency banner when the salon is not in the Safety Community', () => {
  beforeEach(() => { activeAlerts.mockReset(); settings.mockReset(); hooks.onRefetch = undefined; });
  it('never asks for alerts while the community is off (no 403 at all); a realtime community push re-checks', async () => {
    settings.mockResolvedValue({ enabled: false });
    activeAlerts.mockResolvedValue([]);
    render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
    await flush();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(activeAlerts).not.toHaveBeenCalled();
    await hooks.onRefetch?.('interval'); await flush();
    await hooks.onRefetch?.('interval'); await flush();
    expect(activeAlerts).not.toHaveBeenCalled();                   // no polling while the community is off
    expect(settings).toHaveBeenCalledTimes(1);                     // and no settings polling either
    settings.mockResolvedValue({ enabled: true });
    await hooks.onRefetch?.('manual'); await flush();              // the salon turned it on (pushed community event)
    expect(settings).toHaveBeenCalledTimes(2);
    expect(activeAlerts).toHaveBeenCalledTimes(1);
  });
  it('a salon in the community polls alerts on the interval without re-reading settings', async () => {
    settings.mockResolvedValue({ enabled: true });
    activeAlerts.mockResolvedValue([]);
    render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
    await flush();
    await hooks.onRefetch?.('interval'); await flush();
    expect(activeAlerts).toHaveBeenCalledTimes(2);
    expect(settings).toHaveBeenCalledTimes(1);
  });
  it('a 403 community_disabled from alerts (turned off between reads) still stops polling', async () => {
    settings.mockResolvedValue({ enabled: true });
    activeAlerts.mockRejectedValue(Object.assign(new Error('off'), { status: 403, code: 'community_disabled' }));
    render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
    await flush();
    await hooks.onRefetch?.('interval'); await flush();
    expect(activeAlerts).toHaveBeenCalledTimes(1);
  });
  it('any other error keeps polling (a network blip is not "off")', async () => {
    settings.mockResolvedValue({ enabled: true });
    activeAlerts.mockRejectedValue(Object.assign(new Error('down'), { status: 503, code: 'ERROR' }));
    render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
    await flush();
    await hooks.onRefetch?.('interval'); await flush();
    expect(activeAlerts).toHaveBeenCalledTimes(2);
  });
  it('settings unreadable → falls back to asking for alerts (never hides a real alert on a blip)', async () => {
    settings.mockRejectedValue(Object.assign(new Error('down'), { status: 503 }));
    activeAlerts.mockResolvedValue([]);
    render(<MemoryRouter><CommunityEmergencyBanner /></MemoryRouter>);
    await flush();
    expect(activeAlerts).toHaveBeenCalledTimes(1);
  });
});
