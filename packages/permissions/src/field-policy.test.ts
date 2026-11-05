// Constitution 7 §82 / §43 — field-level minimisation.
import { describe, it, expect } from 'vitest';
import { platformPermissionsFor } from './rbac';
import { hiddenClasses, minimizeFields, MASK, classOfField } from './field-policy';

const record = { tenant: 'Belle Palace', technicians: [{ name: 'Amy', commissionRate: 0.6, payroll_total: 4200 }],
  payout: { bankAccountNumber: '000123456', routing_number: '021000021', bankName: 'Chase' },
  appointment: { id: 'a1', customerName: 'Jane Doe', customerPhone: '5551112222', privateNotes: 'allergic to acetone', service: 'Gel' } };

describe('field-level minimisation', () => {
  it('a Platform Super Admin sees everything (no hidden classes — today\'s behaviour is unchanged)', () => {
    expect(hiddenClasses(platformPermissionsFor('PLATFORM_SUPER_ADMIN'))).toEqual([]);
    expect(minimizeFields(record, [])).toBe(record);
  });
  it('a Support account: compensation, bank, customer contact and private notes are masked; the rest is intact', () => {
    const h = hiddenClasses(platformPermissionsFor('PLATFORM_SUPPORT'));
    expect(h.sort()).toEqual(['bank', 'compensation', 'customerContact', 'privateNotes']);
    const m: any = minimizeFields(record, h);
    expect(m.technicians[0]).toEqual({ name: 'Amy', commissionRate: MASK, payroll_total: MASK });
    expect(m.payout).toEqual({ bankAccountNumber: MASK, routing_number: MASK, bankName: MASK });
    expect(m.appointment).toEqual({ id: 'a1', customerName: MASK, customerPhone: MASK, privateNotes: MASK, service: 'Gel' });
    expect(m.tenant).toBe('Belle Palace');
  });
  it('Finance sees compensation and bank (its domain) but not customer contact or notes', () => {
    expect(hiddenClasses(platformPermissionsFor('PLATFORM_FINANCE')).sort()).toEqual(['customerContact', 'privateNotes']);
  });
  it('exact keys only — ordinary fields that merely contain a word are never caught', () => {
    expect(classOfField('commissionRate')).toBe('compensation');
    expect(classOfField('commissionReportUrl')).toBeNull();
    expect(classOfField('phone')).toBeNull();                      // a salon or staff phone is not customer contact
    expect(minimizeFields({ customerPhone: null }, ['customerContact'])).toEqual({ customerPhone: null });   // null stays null
  });
});

// N-19 (Oct 28 2026): an export download passes through untouched — its bytes are not a record of fields
describe('file downloads are not minimised', () => {
  it('bytes and a StreamableFile-shaped body come back as the same object', () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    expect(minimizeFields(bytes, ['customerContact'])).toBe(bytes);
    const u8 = new Uint8Array([1, 2]);
    expect(minimizeFields(u8, ['customerContact'])).toBe(u8);
    const file = { getStream: () => null, options: { customerPhone: 'x' } };
    expect(minimizeFields(file, ['customerContact'])).toBe(file);
  });
  it('a plain record is still minimised', () => {
    expect(minimizeFields({ customerPhone: '5551112222' }, ['customerContact'])).toEqual({ customerPhone: MASK });
  });
});

