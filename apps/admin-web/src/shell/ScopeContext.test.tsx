// Phase 2 QA: the shared scope context. setScope records the salon; clear returns to platform-wide (null).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScopeProvider, useScope } from './ScopeContext';

function Probe() {
  const { tenantId, tenantName, setScope, clear } = useScope();
  return (
    <div>
      <span data-testid="tid">{tenantId ?? 'none'}</span>
      <span data-testid="tname">{tenantName ?? 'none'}</span>
      <button onClick={() => setScope('t9', 'Lotus Nails')}>set</button>
      <button onClick={() => clear()}>clr</button>
    </div>
  );
}

describe('ScopeContext', () => {
  it('defaults to platform-wide and supports set/clear', () => {
    render(<ScopeProvider><Probe /></ScopeProvider>);
    expect(screen.getByTestId('tid').textContent).toBe('none');

    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('tid').textContent).toBe('t9');
    expect(screen.getByTestId('tname').textContent).toBe('Lotus Nails');

    fireEvent.click(screen.getByText('clr'));
    expect(screen.getByTestId('tid').textContent).toBe('none');
    expect(screen.getByTestId('tname').textContent).toBe('none');
  });

  it('useScope outside a provider falls back to platform-wide (no crash)', () => {
    render(<Probe />);
    expect(screen.getByTestId('tid').textContent).toBe('none');
  });
});
