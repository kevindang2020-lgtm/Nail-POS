// The Screen Check overlay renders its verdict, one row per check and the certified profiles; "Refresh data now" asks
// every open screen to reload through the realtime reconcile event (no reload, nothing written).
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenCheckDialog } from './ScreenCheckDialog';
import { REALTIME_RECONCILE } from '../realtime/realtime-client';

describe('ScreenCheckDialog', () => {
  it('shows a verdict, the checks and the profiles, and reconciles on "Refresh data now"', () => {
    const onClose = vi.fn();
    const seen = vi.fn(); window.addEventListener(REALTIME_RECONCILE, seen);
    render(<ScreenCheckDialog onClose={onClose} />);
    expect(screen.getByTestId('screen-check-verdict').textContent).toMatch(/PASS|WARNING|FAIL/);
    const rows = screen.getByTestId('screen-check-findings').querySelectorAll('tbody tr');
    expect([...rows].map((r) => r.getAttribute('data-check'))).toEqual(expect.arrayContaining(['display', 'fit', 'horizontal', 'modules', 'clipped', 'touch', 'realtime']));
    expect(screen.getByTestId('screen-check-profiles').textContent).toContain('SUNMI FLEX 3');
    fireEvent.click(screen.getByTestId('screen-check-refresh'));
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(REALTIME_RECONCILE, seen);
  });
});
