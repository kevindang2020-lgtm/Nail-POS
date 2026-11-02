// pilot-large-salon-owner.vitest.spec — the pure parts of the pilot's Owner App step at 200 technicians
// (scripts/lib/pilot-large-salon-owner.mjs, 200-technician mandate §62 / §69): the per-technician comparison with the
// database, the top-services agreement (ties at the cut), and the CSV reader for the Staff report export.
import { describe, it, expect } from 'vitest';
const { diffTechnicianRows, topServicesAgree, parseCsv, OWNER_PERIODS }: any = await import('../../scripts/lib/pilot-large-salon-owner.mjs');   // a plain .mjs pilot helper

describe('pilot owner step — pure helpers', () => {
  it('diffTechnicianRows: equal rows pass; a technician the database has no money for must show zeros', () => {
    const db = new Map([['t1', { services: 2, sales: 9000, commission: 5400 }]]);
    expect(diffTechnicianRows([{ technicianId: 't1', servicesCompleted: 2, salesCents: 9000, commissionCents: 5400 }, { technicianId: 't2', servicesCompleted: 0, salesCents: 0, commissionCents: 0 }], db)).toEqual([]);
    expect(diffTechnicianRows([{ technicianId: 't1', servicesCompleted: 2, salesCents: 8999, commissionCents: 5400 }], db)).toHaveLength(1);
    expect(diffTechnicianRows([{ technicianId: 't3', servicesCompleted: 1, salesCents: 0, commissionCents: 0 }], db)).toHaveLength(1);
  });
  it('topServicesAgree: same revenue per name, everything above the cut present, ties at the cut either way, descending', () => {
    const db = [{ name: 'A', revenueCents: 500 }, { name: 'B', revenueCents: 300 }, { name: 'C', revenueCents: 200 }, { name: 'D', revenueCents: 200 }];
    expect(topServicesAgree([{ name: 'A', revenueCents: 500 }, { name: 'B', revenueCents: 300 }, { name: 'D', revenueCents: 200 }], db)).toBe(true);
    expect(topServicesAgree([{ name: 'A', revenueCents: 500 }, { name: 'C', revenueCents: 200 }, { name: 'D', revenueCents: 200 }], db)).toBe(false);   // B missing
    expect(topServicesAgree([{ name: 'A', revenueCents: 499 }], db)).toBe(false);
    expect(topServicesAgree([{ name: 'B', revenueCents: 300 }, { name: 'A', revenueCents: 500 }], db)).toBe(false);   // not descending
  });
  it('parseCsv: quoted commas and escaped quotes', () => {
    expect(parseCsv('Technician,Sales (USD)\n"Le, Anna",12.50\n"Mia ""M""",0.00\n')).toEqual([['Technician', 'Sales (USD)'], ['Le, Anna', '12.50'], ['Mia "M"', '0.00']]);
  });
  it('the periods are the mandate\'s weekly / monthly / YTD', () => { expect(OWNER_PERIODS).toEqual(['week', 'month', 'year']); });
});
