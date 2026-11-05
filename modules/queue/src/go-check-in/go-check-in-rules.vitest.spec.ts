// go-check-in-rules.vitest.spec.ts — 23-inch dual-screen spec §16–§17, §20–§27: the pure rules of a guest's own
// check-in (kiosk and customer display alike): the visit, who may be asked for, the add-on convention, the wait band.
import { describe, it, expect } from 'vitest';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import {
  clockLabel, minutesOf, waitRangeFor, visitFor, visitAnchoredAt, isWorkingRestOfToday, kioskTechnicians, requiredCategories,
  technicianNames, VISIT_WINDOW_MINUTES, type KioskTechFacts,
} from './go-check-in-rules';

const at = (hhmm: string) => minutesOf(hhmm)!;
const tech = (over: Partial<KioskTechFacts> = {}): KioskTechFacts => ({
  technicianId: 't1', firstName: 'Olivia', lastName: 'Tran', skills: ['Manicure'], shift: { startMinutes: at('09:00'), endMinutes: at('18:00') },
  blocks: [], clockedIn: false, liveStatus: null, ...over,
});

describe('labels and the wait band (§16, §26–§27)', () => {
  it('the branch clock as a guest reads it', () => {
    expect(clockLabel('14:30')).toBe('2:30 PM');
    expect(clockLabel('09:05:00')).toBe('9:05 AM');
    expect(clockLabel('00:15')).toBe('12:15 AM');
    expect(clockLabel('12:00')).toBe('12:00 PM');
    expect(clockLabel('later')).toBe('later');
  });
  it('the band comes from the queue engine\'s minutes — nothing for a missing or broken estimate', () => {
    expect(waitRangeFor(25)).toEqual({ fromMinutes: 25, toMinutes: 35 });
    expect(waitRangeFor(0)).toEqual({ fromMinutes: 0, toMinutes: 10 });
    expect(waitRangeFor(12.6)).toEqual({ fromMinutes: 13, toMinutes: 23 });
    for (const bad of [undefined, null, NaN, -3, '15']) expect(waitRangeFor(bad)).toBeUndefined();
  });
});

describe('the visit (§16–§17)', () => {
  const a = (id: string, start: string, end: string) => ({ appointmentId: id, startMinutes: at(start), endMinutes: at(end) });
  it('booked together (same time, two technicians) or back to back is ONE visit; the 2 pm appointment is not', () => {
    const appts = [a('pedi', '11:00', '11:50'), a('later', '14:00', '15:00'), a('mani', '11:00', '11:45'), a('art', '11:45', '12:15')];
    expect(visitFor(appts, at('10:52')).map((x) => x.appointmentId)).toEqual(['mani', 'pedi', 'art']);
  });
  it('a long-over appointment is not the visit: an afternoon arrival gets the afternoon visit', () => {
    const appts = [a('morning', '09:00', '09:45'), a('afternoon', '14:00', '15:00')];
    expect(visitFor(appts, at('13:55')).map((x) => x.appointmentId)).toEqual(['afternoon']);
    expect(visitFor(appts, at('10:30')).map((x) => x.appointmentId)).toEqual(['morning']);   // ended under an hour ago: still theirs
  });
  it('very late for the only appointment: still offered (the front desk decides) — nothing at all: no visit', () => {
    expect(visitFor([a('morning', '09:00', '09:45')], at('16:00')).map((x) => x.appointmentId)).toEqual(['morning']);
    expect(visitFor([], at('12:00'))).toEqual([]);
  });
  it('"I\'m Here" checks in the visit the screen showed, anchored on its first appointment', () => {
    const appts = [a('mani', '11:00', '11:45'), a('pedi', '11:00', '11:50'), a('later', '14:00', '15:00')];
    expect(visitAnchoredAt(appts, 'mani').map((x) => x.appointmentId)).toEqual(['mani', 'pedi']);
    expect(visitAnchoredAt(appts, 'later').map((x) => x.appointmentId)).toEqual(['later']);
    expect(visitAnchoredAt(appts, 'nope')).toEqual([]);
    expect(VISIT_WINDOW_MINUTES).toBe(60);
  });
});

describe('who may be asked for (§25)', () => {
  it('working the rest of today: clocked in, or scheduled with some of the shift still ahead and not blocked', () => {
    const now = at('12:00');
    expect(isWorkingRestOfToday(tech(), now)).toBe(true);
    expect(isWorkingRestOfToday(tech({ shift: null }), now)).toBe(false);                                            // not scheduled today
    expect(isWorkingRestOfToday(tech({ shift: null, clockedIn: true }), now)).toBe(true);                             // came in anyway
    expect(isWorkingRestOfToday(tech({ shift: { startMinutes: at('08:00'), endMinutes: at('11:30') } }), now)).toBe(false);   // gone home
    expect(isWorkingRestOfToday(tech({ shift: { startMinutes: at('15:00'), endMinutes: at('20:00') } }), now)).toBe(true);    // later today
    expect(isWorkingRestOfToday(tech({ blocks: [{ startMinutes: at('11:00'), endMinutes: at('18:00') }] }), now)).toBe(false); // off the rest of the day
    expect(isWorkingRestOfToday(tech({ blocks: [{ startMinutes: at('12:00'), endMinutes: at('13:00') }] }), now)).toBe(true);  // lunch, then back
    expect(isWorkingRestOfToday(tech({ liveStatus: 'off_shift' }), now)).toBe(false);                                 // the front desk says off
    expect(isWorkingRestOfToday(tech({ liveStatus: 'on_break' }), now)).toBe(true);                                   // a break is still today
  });
  it('qualified for every chosen service (the queue\'s category skills); add-ons are done by whoever does the service', () => {
    const catalog = [{ id: 'gel', category: 'Manicure', isAddOn: false }, { id: 'pedi', category: 'Pedicure', isAddOn: false }, { id: 'art', category: 'Add-ons', isAddOn: true }];
    expect(requiredCategories(['gel', 'art', 'unknown'], catalog)).toEqual(['Manicure']);
    const both = tech({ technicianId: 'both', firstName: 'Lisa', skills: ['Manicure', 'Pedicure'] });
    const mani = tech({ technicianId: 'mani', firstName: 'Olivia', skills: ['Manicure'] });
    const off = tech({ technicianId: 'off', firstName: 'Ava', shift: null });
    expect(kioskTechnicians([mani, both, off], at('12:00'), requiredCategories(['gel', 'pedi'], catalog)).map((t) => t.technicianId)).toEqual(['both']);
    expect(kioskTechnicians([mani, both, off], at('12:00'), []).map((t) => t.name)).toEqual(['Lisa', 'Olivia']);   // nothing chosen yet: everyone working
  });
  it('first names only — a last initial where two share one — and when a later shift starts', () => {
    const names = technicianNames([{ technicianId: 'a', firstName: 'Lisa', lastName: 'Nguyen' }, { technicianId: 'b', firstName: 'Lisa', lastName: 'Park' }, { technicianId: 'c', firstName: 'Mia', lastName: 'Chen' }]);
    expect([...names.values()]).toEqual(['Lisa N.', 'Lisa P.', 'Mia']);
    const [later] = kioskTechnicians([tech({ shift: { startMinutes: at('14:00'), endMinutes: at('20:00') } })], at('11:00'), []);
    expect(later).toMatchObject({ name: 'Olivia', fromLabel: 'From 2:00 PM' });
    const [now] = kioskTechnicians([tech()], at('11:00'), []);
    expect(now.fromLabel).toBeUndefined();
    expect(JSON.stringify(now)).not.toMatch(/Tran/);
  });
});

describe('the add-on convention (§20) — one function for the POS walk-in and the guest\'s check-in', () => {
  it('"Add-ons" in any spelling; nothing else', () => {
    for (const yes of ['Add-ons', 'Add Ons', 'ADDONS', 'add-on', 'Add-On']) expect(isAddOnCategory(yes)).toBe(true);
    for (const no of ['Manicure', 'Additional', 'Nail Art', '', null, undefined]) expect(isAddOnCategory(no)).toBe(false);
  });
});
