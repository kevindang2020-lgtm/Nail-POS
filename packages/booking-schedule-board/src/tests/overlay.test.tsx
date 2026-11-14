// overlay.test.tsx — host marks on the new board (Kevin, Nov 13 2026: "AI scheduling badges on appointments show only on
// the Classic board"). The AI Scheduling Optimizer's lock, open-conflict outline, "AI" suggestion badge and unused gap
// draw on the new board exactly as on the Classic one; a badge tap opens the suggestion and never opens or drags the card.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FULL_PERMISSIONS } from '../adapters/BookingDataAdapter';
import { MockBookingDataAdapter } from '../adapters/MockBookingDataAdapter';
import { BookingScheduleBoard } from '../components/BookingScheduleBoard';
import type { BoardOverlay } from '../domain/scheduleTypes';
import { toISO } from '../domain/time';
import { buildFixture, FIXTURE_BRANCH, FIXTURE_DATE, FIXTURE_TENANT, FIXTURE_TZ } from '../fixtures/fixtures';

const NOW = () => new Date(toISO(FIXTURE_DATE, 9 * 60, FIXTURE_TZ));
beforeAll(() => { (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} }; });
afterEach(cleanup);

describe('host overlay (AI Scheduling Optimizer marks)', () => {
  it('draws lock, conflict, badge and gap for the visible page; a badge tap opens the suggestion only', async () => {
    const data = buildFixture();
    const [a1, a2] = data.appointments.filter((a) => a.technicianId === 'tech-001');
    const onOpenRec = vi.fn();
    const onOpenAppointment = vi.fn();
    const overlay: BoardOverlay = {
      appointments: {
        [a1.id]: { locked: { title: 'Locked — the AI optimizer will not move it' }, conflict: 'critical', badge: { label: 'AI', title: 'AI optimizer suggestion', ariaLabel: 'Open the AI optimizer suggestion', onOpen: onOpenRec } },
        [a2.id]: { conflict: 'warning' },
      },
      gaps: [{ id: 'g1', technicianId: 'tech-001', startMinute: 12 * 60, endMinute: 13 * 60, title: '60 min unused' }],
    };
    render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE}
      permissions={FULL_PERMISSIONS} adapter={new MockBookingDataAdapter(data, { now: NOW })} now={NOW}
      onOpenBookingAssistant={vi.fn()} onOpenAppointment={onOpenAppointment} overlay={overlay} />);
    await screen.findByTestId(`bsb-appt-${a1.id}`);
    expect(screen.getByTestId(`bsb-ai-lock-${a1.id}`)).toHaveAttribute('title', 'Locked — the AI optimizer will not move it');
    expect(screen.getByTestId(`bsb-ai-conflict-${a1.id}`)).toHaveAttribute('data-severity', 'critical');
    expect(screen.getByTestId(`bsb-ai-conflict-${a2.id}`)).toHaveAttribute('data-severity', 'warning');
    expect(screen.queryByTestId(`bsb-ai-badge-${a2.id}`)).toBeNull();
    expect(screen.getByTestId('bsb-ai-gap-g1')).toHaveAttribute('title', '60 min unused');
    const badge = screen.getByTestId(`bsb-ai-badge-${a1.id}`);
    expect(badge).toHaveAccessibleName('Open the AI optimizer suggestion');
    fireEvent.pointerDown(badge); fireEvent.click(badge);
    expect(onOpenRec).toHaveBeenCalledTimes(1);
    expect(onOpenAppointment).not.toHaveBeenCalled();
  });

  it('no overlay → no marks (a salon without the optimizer sees the plain board)', async () => {
    const data = buildFixture();
    render(<BookingScheduleBoard tenantId={FIXTURE_TENANT} branchId={FIXTURE_BRANCH} userId="u1" timezone={FIXTURE_TZ} selectedDate={FIXTURE_DATE}
      permissions={FULL_PERMISSIONS} adapter={new MockBookingDataAdapter(data, { now: NOW })} now={NOW} onOpenBookingAssistant={vi.fn()} />);
    await screen.findByTestId('bsb-tech-tech-001');
    expect(document.querySelectorAll('[data-testid^="bsb-ai-"]').length).toBe(0);
  });
});
