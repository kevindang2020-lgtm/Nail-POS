// RealtimeStatusPill.test.tsx — Vietnamese POS §21 (Oct 27 2026): the sync line ("Couldn't refresh — showing data from
// 17s ago") is worded from a code in the POS language and re-words on a switch; the connection states use their keys.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import RealtimeStatusPill from './RealtimeStatusPill';
import { syncStatus } from './useRealtime';
import { REALTIME_STATUS } from './realtime-client';

afterEach(async () => { syncStatus.reset(); await act(async () => { await setLanguage('en'); }); });

describe('RealtimeStatusPill', () => {
  it('a failed background refresh: English, then Vietnamese, from the same data', async () => {
    const now = Date.now();
    function Live() { useLanguage(); return <RealtimeStatusPill />; }
    render(<Live />);
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_STATUS, { detail: { status: 'CONNECTED' } })); });
    expect(screen.queryByTestId('realtime-status-pill')).toBeNull();   // connected + healthy: nothing shown
    act(() => { syncStatus.record({ reason: 'interval' as any, result: 'ok', durationMs: 0, at: now - 17_000 } as any); syncStatus.record({ reason: 'interval' as any, result: 'error', durationMs: 0, at: now, error: new Error('x') } as any); });
    expect(screen.getByTestId('realtime-status-pill').textContent).toMatch(/^Couldn't refresh — showing data from 1[78]s ago$/);
    await act(async () => { await setLanguage('vi'); });
    expect(screen.getByTestId('realtime-status-pill').textContent).toMatch(/^Không làm mới được — đang hiện dữ liệu từ 1[78] giây trước$/);
  });
});
