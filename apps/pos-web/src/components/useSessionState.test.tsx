import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSessionState, readSession } from './useSessionState';
function Probe() { const [f, setF] = useSessionState('t.f', { q: '', page: 1 }); return <button onClick={() => setF({ q: 'gel', page: 3 })} data-testid="b">{f.q}|{f.page}</button>; }
beforeEach(() => sessionStorage.clear());
describe('useSessionState', () => {
  it('restores the value after unmount/remount in the same tab', () => {
    const v = render(<Probe />); fireEvent.click(screen.getByTestId('b')); v.unmount();
    render(<Probe />); expect(screen.getByTestId('b')).toHaveTextContent('gel|3');
  });
  it('bad or foreign stored values fall back to the default shape', () => {
    sessionStorage.setItem('x', '{oops'); expect(readSession('x', { a: 1 })).toEqual({ a: 1 });
    sessionStorage.setItem('y', '"str"'); expect(readSession('y', 5)).toBe(5);
    sessionStorage.setItem('z', '{"b":2}'); expect(readSession('z', { a: 1 })).toEqual({ a: 1, b: 2 });
  });
});

import { clearSessionUiState, scopeSessionUiState } from './useSessionState';
describe('shared terminal hygiene', () => {
  it('a different user / salon drops the remembered aps.* state; the held payment key survives; other keys untouched', () => {
    sessionStorage.clear();
    scopeSessionUiState('t1:b1:u1');
    sessionStorage.setItem('aps.emc.draft', '{"subject":"x"}'); sessionStorage.setItem('aps.rn.buyKey', 'k1'); sessionStorage.setItem('other', '1');
    scopeSessionUiState('t1:b1:u1');
    expect(sessionStorage.getItem('aps.emc.draft')).not.toBeNull();
    scopeSessionUiState('t1:b1:u2');
    expect(sessionStorage.getItem('aps.emc.draft')).toBeNull();
    expect(sessionStorage.getItem('aps.rn.buyKey')).toBe('k1');
    expect(sessionStorage.getItem('other')).toBe('1');
    sessionStorage.setItem('aps.cnx.query', '{}'); clearSessionUiState();
    expect(sessionStorage.getItem('aps.cnx.query')).toBeNull();
  });
});
