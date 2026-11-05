// technician-tips.vitest — Split Tips guide (Nov 5 2026) §13 money scenarios on the pure math.
import { describe, it, expect } from 'vitest';
import { tipRecipients, technicianTips, recipientsKey, splitByWeights, TechTipError, type TipLineInput } from './technician-tips';

const L = (id: string, tech: string | null, name: string, cents: number, extra: Partial<TipLineInput> = {}): TipLineInput => ({ lineId: id, technicianId: tech, technicianName: tech ? tech.toUpperCase() : null, serviceName: name, lineTotalCents: cents, isProduct: false, ...extra });

describe('recipients — who performed, and each one\'s basis', () => {
  it('01/08: one technician with three services is ONE card with the summed basis', () => {
    const r = tipRecipients([L('1', 'a', 'Gel Manicure', 4000), L('2', 'a', 'Nail Art', 1000), L('3', 'a', 'Paraffin', 500)], 0);
    expect(r).toEqual([{ technicianId: 'a', name: 'A', services: ['Gel Manicure', 'Nail Art', 'Paraffin'], basisCents: 5500 }]);
  });
  it('02/09: two and three technicians each get their own card; product lines carry no tip basis', () => {
    const r = tipRecipients([L('1', 'a', 'Manicure', 4000), L('2', 'b', 'Pedicure', 6000), L('3', 'c', 'Brows', 2000), L('4', 'a', 'Polish bottle', 1500, { isProduct: true })], 0);
    expect(r.map((x) => `${x.technicianId}:${x.basisCents}`)).toEqual(['a:4000', 'b:6000', 'c:2000']);
  });
  it('10: a line with no performer gives nobody a card (a booked-but-absent technician never appears)', () => {
    expect(tipRecipients([L('1', null, 'Manicure', 4000)], 0)).toEqual([]);
  });
  it('11: a shared service uses its recorded shares, never an invented split; shares that do not total 100% fall back to the line\'s technician', () => {
    const r = tipRecipients([L('1', 'a', 'Full set', 10000, { shares: [{ technicianId: 'a', shareBps: 7000 }, { technicianId: 'b', shareBps: 3000, name: 'Bee' }] })], 0);
    expect(r.map((x) => `${x.technicianId}:${x.basisCents}`)).toEqual(['a:7000', 'b:3000']);
    expect(tipRecipients([L('1', 'a', 'Full set', 10000, { shares: [{ technicianId: 'b', shareBps: 3000 }] })], 0).map((x) => x.technicianId)).toEqual(['a']);
  });
  it('36: the ticket discount is spread by line size before the percent basis (exact cents)', () => {
    const r = tipRecipients([L('1', 'a', 'Manicure', 4000), L('2', 'b', 'Pedicure', 6000)], 1000);
    expect(r.map((x) => x.basisCents)).toEqual([3600, 5400]);
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it('12: a changed performer or price changes the key (an old selection goes stale)', () => {
    const k1 = recipientsKey(tipRecipients([L('1', 'a', 'M', 4000)], 0));
    expect(recipientsKey(tipRecipients([L('1', 'b', 'M', 4000)], 0))).not.toBe(k1);
    expect(recipientsKey(tipRecipients([L('1', 'a', 'M', 4500)], 0))).not.toBe(k1);
  });
});

describe('each technician\'s tip', () => {
  const rs = tipRecipients([L('1', 'a', 'Manicure', 4000), L('2', 'b', 'Pedicure', 6000)], 0);
  it('02: A=$5, B=$10 stays exactly that — $15 total, unequal, never 50/50', () => {
    expect(technicianTips(rs, [{ technicianId: 'a', tipType: 'custom', amountCents: 500 }, { technicianId: 'b', tipType: 'custom', amountCents: 1000 }], 100)).toMatchObject({ totalCents: 1500, items: [{ technicianId: 'a', tipCents: 500 }, { technicianId: 'b', tipCents: 1000 }] });
  });
  it('03/04: an explicit No Tip is a choice (0), not missing', () => {
    const r = technicianTips(rs, [{ technicianId: 'a', tipType: 'none' }, { technicianId: 'b', tipType: 'custom', amountCents: 1000 }], 100);
    expect(r.items[0]).toMatchObject({ tipType: 'none', tipCents: 0 }); expect(r.totalCents).toBe(1000);
    expect(technicianTips(rs, [{ technicianId: 'a', tipType: 'none' }, { technicianId: 'b', tipType: 'none' }], 100).totalCents).toBe(0);
  });
  it('06: 20% of A=$40 and B=$60 is $8 + $12 — never 20% of the ticket twice', () => {
    expect(technicianTips(rs, [{ technicianId: 'a', tipType: 'percent', percent: 20 }, { technicianId: 'b', tipType: 'percent', percent: 20 }], 100).items.map((i) => i.tipCents)).toEqual([800, 1200]);
  });
  it('07: a custom $7.25 stays exact; fractional cents are refused', () => {
    expect(technicianTips(rs, [{ technicianId: 'a', tipType: 'custom', amountCents: 725 }], 100).totalCents).toBe(725);
    expect(() => technicianTips(rs, [{ technicianId: 'a', tipType: 'custom', amountCents: 7.5 }], 100)).toThrow(TechTipError);
  });
  it('24: a technician who did not perform a service is refused; a duplicate is refused', () => {
    expect(() => technicianTips(rs, [{ technicianId: 'zzz', tipType: 'custom', amountCents: 500 }], 100)).toThrow(/did not perform/);
    expect(() => technicianTips(rs, [{ technicianId: 'a', tipType: 'none' }, { technicianId: 'a', tipType: 'none' }], 100)).toThrow(/one tip/);
  });
  it('a tip above the salon maximum for one technician is refused', () => {
    expect(() => technicianTips(rs, [{ technicianId: 'a', tipType: 'custom', amountCents: 60000 }], 100)).toThrow(/higher than/);
  });
});
