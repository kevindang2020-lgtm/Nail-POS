// CustomerLayout.test.tsx — BUILD_PLAN Phase 13 B (Constitution 6 §52, §54): the Deals tab follows the remote flag
// `deals` (rollout / kill through /app-config) and hides while the deals engine kill switch is on.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppConfigGate, resetAppConfig } from '@aipowersalon/mobile-sdk';
import { CustomerLayout } from './CustomerLayout';

const cfg = (flags: Record<string, boolean>, modules: any[] = []) => async () => ({
  app: 'customer', platform: 'web', version: '1.6.0', flags, modules,
  update: { state: 'SUPPORTED', minimumVersion: null, recommendedVersion: null, latestVersion: null, storeUrl: null, message: null },
  maintenance: { active: false, mode: null, message: null, banner: null }, breakGlass: { mode: 'off', message: null }, refreshAfterSeconds: 300, serverTime: '',
}) as any;
const view = (fetchConfig: any) => render(<MemoryRouter><AppConfigGate app="customer" version="1.6.0" platform="web" fetchConfig={fetchConfig}><CustomerLayout><p>home</p></CustomerLayout></AppConfigGate></MemoryRouter>);
afterEach(() => { cleanup(); resetAppConfig(); });

describe('Deals tab — remote flag + kill switch', () => {
  it('shown by default and when the flag is on', async () => {
    view(cfg({ deals: true }));
    await screen.findByText('home');
    expect(screen.getByRole('link', { name: /deals/i })).toBeTruthy();
  });
  it('hidden when the flag is off (rollout / kill)', async () => {
    view(cfg({ deals: false }));
    await screen.findByText('home');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: /deals/i })).toBeNull();
  });
  it('hidden while the deals engine kill switch is on', async () => {
    view(cfg({ deals: true }, [{ module: 'deals', available: false, message: 'Deals are temporarily unavailable.' }]));
    await screen.findByText('home');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('link', { name: /deals/i })).toBeNull();
  });
});
