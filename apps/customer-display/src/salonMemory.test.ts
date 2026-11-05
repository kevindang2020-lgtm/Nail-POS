// salonMemory.test.ts — 23-inch spec §13, §72: what a paired display keeps about its salon for a restart without network —
// the salon's name and branding, never a customer; a corrupted or tampered value is ignored or cleaned on the way back.
import { describe, it, expect } from 'vitest';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import { SALON_STORE_KEY, recallSalon, rememberSalon, salonOf } from './salonMemory';

const store = () => { const m = new Map<string, string>(); let writes = 0; return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { writes++; m.set(k, v); }, writes: () => writes, raw: () => m.get(SALON_STORE_KEY) }; };
const BRANDING = { salonName: 'Luxury Nails', logoUrl: '/media/salon-logos/e1000000-0000-4000-8000-0000000000a1/logo-0123456789abcdef01234567.png', tagline: 'Luxury for every hand', branchName: 'Cherry Hill', idleMessage: 'Ready for our next guest' };
const checkout = {
  state: 'payment_success', salonName: 'Luxury Nails', sessionId: 'sess-9', version: 4, customer: { firstName: 'Sophia' },
  checkout: { ticketNumber: '#12', lines: [{ kind: 'service', name: 'Gel Manicure', amountCents: 4500 }] }, tipOptions: [], selectedTipCents: 900,
  totals: { subtotalCents: 4500, tipCents: 900, taxCents: 300, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 5700 }, payButtonEnabled: false,
  branding: { ...BRANDING, extra: 'Sophia' },
} as unknown as CustomerDisplayState;

describe('remembering the salon', () => {
  it('keeps the salon\'s name and branding — field by field, nothing of the customer on the screen at the time', () => {
    const s = store();
    rememberSalon(checkout, s);
    const raw = s.raw()!;
    expect(JSON.parse(raw)).toEqual({ salonName: 'Luxury Nails', branding: BRANDING });
    for (const leak of ['Sophia', 'sess-9', '#12', 'Gel Manicure', '5700', 'tipOptions', 'customer']) expect(raw).not.toContain(leak);
    expect(salonOf({ salonName: 'X' } as any)).toEqual({ salonName: 'X' });
  });

  it('writes only when something changed', () => {
    const s = store();
    rememberSalon(checkout, s); rememberSalon(checkout, s); rememberSalon({ ...checkout, state: 'idle' } as any, s);
    expect(s.writes()).toBe(1);
    rememberSalon({ ...checkout, branding: { ...BRANDING, tagline: 'New tagline' } } as any, s);
    expect(s.writes()).toBe(2);
  });

  it('storage that throws never breaks the display', () => {
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(() => rememberSalon(checkout, bad)).not.toThrow();
    expect(recallSalon(bad)).toBeNull();
  });
});

describe('recalling it', () => {
  it('round-trips', () => {
    const s = store();
    rememberSalon(checkout, s);
    expect(recallSalon(s)).toEqual({ salonName: 'Luxury Nails', branding: BRANDING });
  });

  it('garbage, foreign JSON or nothing → null', () => {
    for (const v of [null, '', 'not json', '42', '[]', '{"name":"x"}', '{"salonName":7}']) {
      const s = store(); if (v !== null) s.setItem(SALON_STORE_KEY, v);
      expect(recallSalon(s)).toBeNull();
    }
  });

  it('a logo address that is not the salon\'s stored logo is dropped; text is capped; extra fields are not carried', () => {
    const s = store();
    s.setItem(SALON_STORE_KEY, JSON.stringify({ salonName: 'Luxury Nails', branding: { ...BRANDING, logoUrl: 'https://evil.example/x.png', tagline: 'T'.repeat(500), customer: 'Sophia' } }));
    const r = recallSalon(s)!;
    expect(r.branding!.logoUrl).toBeNull();
    expect(r.branding!.tagline).toHaveLength(60);
    expect(JSON.stringify(r)).not.toContain('Sophia');
    for (const ok of ['/media/salon-logos/t1/logo-0123456789abcdef01234567.webp', 'https://cdn.example.com/aps/salon-logos/t1/logo-0123456789abcdef01234567.jpg']) {
      s.setItem(SALON_STORE_KEY, JSON.stringify({ salonName: 'L', branding: { ...BRANDING, logoUrl: ok } }));
      expect(recallSalon(s)!.branding!.logoUrl).toBe(ok);
    }
    for (const bad of ['javascript:alert(1)', '/media/salon-logos/t1/logo-x.png', 'http://cdn.example.com/salon-logos/t1/logo-0123456789abcdef01234567.png', '/media/display-ads/a/medium.webp']) {
      s.setItem(SALON_STORE_KEY, JSON.stringify({ salonName: 'L', branding: { ...BRANDING, logoUrl: bad } }));
      expect(recallSalon(s)!.branding!.logoUrl).toBeNull();
    }
  });
});
