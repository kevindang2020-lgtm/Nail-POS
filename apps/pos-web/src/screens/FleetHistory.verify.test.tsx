// extras Device Assignments 25 (round 10): the History tab verifies the device-history hash chain (read only).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const m = vi.hoisted(() => ({ history: vi.fn(), verifyHistory: vi.fn() }));
vi.mock('../api/posDeviceFleetApi', () => ({ posDeviceFleetApi: { history: m.history, verifyHistory: m.verifyHistory } }));
import { FleetHistory } from './POSDeviceFleetScreen';

describe('FleetHistory — Verify history', () => {
  it('shows the server verdict, counts and the first problems in words; nothing else is called', async () => {
    m.history.mockResolvedValue({ class: 'all', items: [], total: 0, page: 1, pageSize: 25, totalPages: 1 });
    m.verifyHistory.mockResolvedValue({ checkedAt: '2026-11-13T10:00:00Z', links: 3, intact: 1, altered: 1, broken: 0, prunedByRetention: 0, missing: 1, state: 'TAMPERED',
      findings: [{ seq: 2, auditLogId: 'a2', kind: 'altered', entityType: 'payment_terminal', entityId: 't1' }, { seq: 3, auditLogId: 'a3', kind: 'missing', entityType: 'customer_display', entityId: 'd1' }] });
    render(<FleetHistory cls="all" />);
    fireEvent.click(await screen.findByTestId('dfx-h-verify'));
    const r = await screen.findByTestId('dfx-h-verify-findings');
    expect(screen.getByTestId('dfx-h-verify-result')).toHaveTextContent('History changed');
    expect(screen.getByTestId('dfx-h-verify-result')).toHaveTextContent('3 links · 1 intact · 1 changed · 0 broken links · 1 missing');
    expect(r).toHaveTextContent('#2 · record changed after it was written'); expect(r).toHaveTextContent('#3 · record missing');
    expect(r.textContent).not.toMatch(/altered|payment_terminal/);
  });
});
