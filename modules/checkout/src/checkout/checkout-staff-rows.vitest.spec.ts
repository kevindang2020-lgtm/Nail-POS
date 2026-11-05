import { describe, it, expect } from 'vitest';
import { buildStaffRows, staffStatusLabel } from './checkout.dto';

describe('buildStaffRows (real technician presence)', () => {
  it('maps presence statuses and lists Ready technicians first with "Now"', () => {
    const techs = [
      { id: 'a', name: 'Mia Johnson', baseStatus: 'active' },
      { id: 'b', name: 'Samantha Green', baseStatus: 'active' },
      { id: 'c', name: 'Grace Hall', baseStatus: 'active' },
      { id: 'd', name: 'Off Tech', baseStatus: 'active' },
    ];
    const rows = buildStaffRows(techs, { a: 'busy', b: 'available', c: 'on_break', d: 'off_shift' });
    // off_shift excluded
    expect(rows.map((r) => r.name)).toEqual(['Samantha Green', 'Mia Johnson', 'Grace Hall']);
    expect(rows[0]).toMatchObject({ name: 'Samantha Green', status: 'Ready', nextAvailable: 'Now' });
    expect(rows.find((r) => r.name === 'Mia Johnson')).toMatchObject({ status: 'Busy', nextAvailable: '—' });
    expect(rows.find((r) => r.name === 'Grace Hall')).toMatchObject({ status: 'Break', nextAvailable: '—' });
  });

  it('falls back to base status when no live presence row exists', () => {
    const rows = buildStaffRows([{ id: 'x', name: 'Lily', baseStatus: 'active' }], {});
    expect(rows[0]).toMatchObject({ status: 'Ready', nextAvailable: 'Now' });
  });

  it('staffStatusLabel returns null for excluded states', () => {
    expect(staffStatusLabel('off_shift')).toBeNull();
    expect(staffStatusLabel('serving')).toBe('Busy');
  });
});
