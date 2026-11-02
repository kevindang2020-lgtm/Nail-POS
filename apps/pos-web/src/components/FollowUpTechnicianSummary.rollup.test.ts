// Jul 29, 2026: rollupByTech was exported but had no consumer outside its own file — this test IS the consumer,
// pinning the rollup math (per-tech counts + ordering) so the export earns its keep. Fix-don't-remove.
import { describe, it, expect } from 'vitest';
import { rollupByTech } from './FollowUpTechnicianSummary';

const t = (id: string, tech: string, status: string) => ({ technicianId: id, technicianName: tech, status } as any);

describe('rollupByTech', () => {
  it('groups tasks per technician with pending/completed counts', () => {
    const rows = rollupByTech([t('t1', 'Mia', 'pending'), t('t1', 'Mia', 'sent'), t('t1', 'Mia', 'pending'), t('t2', 'Ava', 'pending')]);
    expect(rows.length).toBe(2);
    expect(rows[0].technicianName).toBe('Mia');           // most pending first
    expect(rows[0].pending).toBe(2);
    expect(rows[0].sent).toBe(1);
    expect(rows[0].total).toBe(3);
    expect(rows[1].pending).toBe(1);
  });
  it('empty input yields empty rollup, never a fabricated row', () => {
    expect(rollupByTech([])).toEqual([]);
  });
});
