// SalonLogoSetting.test.tsx — Settings: the salon's branding on its 23-inch customer display (spec §13). The Customer
// Display section saves the tagline and the branch-name choice; Receipts & Branding uploads, shows, replaces and
// removes the ONE salon logo used on receipts and on the displays. The picture preparation itself (canvas) is a real
// browser's job — salonLogoImage's sizing rules are tested here, the encode is proven in the live browser run.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const prep = vi.hoisted(() => ({ prepareLogo: vi.fn() }));
vi.mock('./salonLogoImage', async (orig) => ({ ...(await orig<typeof import('./salonLogoImage')>()), prepareLogo: prep.prepareLogo }));

import { POSSettingsScreen } from './POSSettingsScreen';
import { logoPrecheck, logoTargetSize, LOGO_RULES } from './salonLogoImage';

const state = {
  context: { role: 'OWNER', permissions: [] },
  businessBranch: { salonName: 'Palace', legalName: 'Palace LLC', businessType: 'salon', branchName: 'Main', currency: 'USD', timezone: 'America/New_York', multiBranchEnabled: false },
  paymentsCheckout: { methods: { card: true, cash: true, giftCard: true, split: true }, creditCardSurchargeEnabled: false, creditCardSurchargePercent: 0, cashDiscountEnabled: false, customerDisplayMode: 'review_only', managerApprovalOverCents: 0 },
  tips: { defaultTipPercents: [15, 18, 20], allowCustomTip: true, allowNoTip: true, maxTipPercent: 30, tipBase: 'pretax' },
  tax: { enabled: true, taxRatePercent: 7, taxLabel: 'Sales Tax', mode: 'exclusive', appliesToServices: true, appliesToProducts: true },
  notifications: { smsConfirmation: true, emailConfirmation: true, pushConfirmation: false, reminderHours: [24], receiptDelivery: ['sms'], senderBrand: 'Palace', a2pStatus: 'pending' },
  onlineGoogleAiBooking: { onlineBookingEnabled: true, tenantSlug: 'palace', aiPhoneEnabled: false, aiActions: { findAvailability: true, create: true, reschedule: true, cancel: true, sendReminder: true } },
  sectionStatuses: [],
  moduleStatus: { completionPercent: 0, status: 'in_progress', missingReasons: [], goLivePending: [] },
};
const display = { enabled: true, displayMode: 'tip_only', idleMessage: 'Ready for next guest', sessionTimeoutMinutes: 5, tipPromptEnabled: true, receiptPromptEnabled: true, displayBranding: true, tagline: '', showBranchName: false };
const receipts = { showLogo: false, header: 'Palace', footer: '', businessAddress: '', thankYouMessage: 'Thanks!', showSurchargeLine: true, showTechnicianLines: true, showServiceNotes: false, showDiscountLine: true, showLoyaltyPoints: true, showTips: true, defaultDelivery: ['sms'], brandStyle: 'classic' };
const LOGO_URL = '/media/salon-logos/t1/logo-0123456789abcdef01234567.png';

type Call = { method: string; url: string; body: any };
let calls: Call[];
let logo: { url: string; width: number; height: number; updatedAt: string } | null;
let failUpload: string | null;
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } } as any);

beforeEach(() => {
  vi.restoreAllMocks();
  prep.prepareLogo.mockReset();
  calls = []; logo = null; failUpload = null;
  globalThis.fetch = vi.fn(async (u: any, init: any = {}) => {
    const url = String(u); const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body });
    if (url.endsWith('/pos/settings/receipts-branding/logo/remove')) { logo = null; return reply(200, { removed: true }); }
    if (url.endsWith('/pos/settings/receipts-branding/logo')) {
      if (method === 'GET') return reply(200, logo);
      if (failUpload) return reply(400, { message: failUpload });
      logo = { url: LOGO_URL, width: 640, height: 320, updatedAt: '2026-10-06T06:00:00.000Z' };
      return reply(201, { logoRef: LOGO_URL, logoUrl: LOGO_URL, width: 640, height: 320 });
    }
    if (url.endsWith('/pos/settings/customer-display-devices')) return reply(200, display);
    if (url.endsWith('/pos/settings/receipts-branding')) return reply(200, receipts);
    return reply(200, state);
  }) as any;
});

const open = async (title: string) => {
  render(<MemoryRouter><POSSettingsScreen /></MemoryRouter>);
  await screen.findByText('Settings');
  const h = screen.getByText(title, { selector: 'h2' });
  fireEvent.click(h.parentElement!.querySelector('button')!);   // the section's Edit button
  return h.closest('section') as HTMLElement;
};

describe('Settings → Customer Display: the salon\'s words on its display', () => {
  it('edits the tagline (60 characters at most) and the branch-name choice, and saves them with the section', async () => {
    const sec = await open('Customer Display');
    const tagline = (await within(sec).findByPlaceholderText('Nails · Spa · Lashes')) as HTMLInputElement;
    expect(tagline.maxLength).toBe(60);
    expect((within(sec).getByPlaceholderText('Welcome! Please check in.') as HTMLInputElement).maxLength).toBe(80);
    fireEvent.change(tagline, { target: { value: '  Nails & Spa since 2009  ' } });
    fireEvent.click(within(sec).getByLabelText('show branch name'));
    fireEvent.click(within(sec).getByText('Save Customer Display'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const saved = calls.find((c) => c.method === 'PATCH')!;
    expect(saved.url).toMatch(/\/pos\/settings\/customer-display-devices$/);
    expect(saved.body).toMatchObject({ tagline: 'Nails & Spa since 2009', showBranchName: true, displayBranding: true, idleMessage: 'Ready for next guest' });
  });

  it('a refusal from the server (e.g. markup in the tagline) is shown, nothing is pretended', async () => {
    const sec = await open('Customer Display');
    (globalThis.fetch as any).mockImplementationOnce(async () => reply(400, { message: 'tagline cannot contain HTML' }));
    fireEvent.change(await within(sec).findByPlaceholderText('Nails · Spa · Lashes'), { target: { value: '<b>Hi</b>' } });
    fireEvent.click(within(sec).getByText('Save Customer Display'));
    expect(await screen.findByText('tagline cannot contain HTML')).toBeInTheDocument();
  });
});

describe('Settings → Receipts & Branding: the salon logo', () => {
  it('no logo yet → upload: the prepared picture is posted as a data URL, shown, and the receipt "logo" box follows', async () => {
    prep.prepareLogo.mockResolvedValue({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 640, height: 320, bytes: 9, type: 'image/png' });
    const sec = await open('Receipts & Branding');
    const box = await within(sec).findByTestId('salon-logo-setting');
    expect(await within(box).findByText('No logo yet')).toBeInTheDocument();
    expect((within(sec).getByLabelText('logo') as HTMLInputElement).checked).toBe(false);

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(within(box).getByLabelText('Salon logo file'), { target: { files: [file] } });
    const img = (await within(box).findByAltText('Salon logo')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(LOGO_URL);
    expect(prep.prepareLogo).toHaveBeenCalledWith(file);
    const post = calls.find((c) => c.method === 'POST' && /\/logo$/.test(c.url))!;
    expect(post.body).toEqual({ logo: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(within(box).getByRole('status').textContent).toMatch(/Logo saved/);
    expect((within(sec).getByLabelText('logo') as HTMLInputElement).checked).toBe(true);
    expect(within(box).getByText('Replace logo')).toBeInTheDocument();
  });

  it('an existing logo is shown; Remove takes it off and unticks the receipt "logo" box', async () => {
    logo = { url: LOGO_URL, width: 640, height: 320, updatedAt: '2026-10-06T06:00:00.000Z' };
    const sec = await open('Receipts & Branding');
    const box = await within(sec).findByTestId('salon-logo-setting');
    expect(((await within(box).findByAltText('Salon logo')) as HTMLImageElement).getAttribute('src')).toBe(LOGO_URL);
    fireEvent.click(within(sec).getByLabelText('logo'));   // the form says "on" before the removal…
    fireEvent.click(within(box).getByText('Remove logo'));
    expect(await within(box).findByText('No logo yet')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && /\/logo\/remove$/.test(c.url))).toBe(true);
    expect((within(sec).getByLabelText('logo') as HTMLInputElement).checked).toBe(false);   // …and follows it
  });

  it('a picture the browser cannot prepare is refused with its reason — nothing is uploaded', async () => {
    prep.prepareLogo.mockRejectedValue(new Error('That image is too small (20×20). Use at least 32 pixels per side.'));
    const sec = await open('Receipts & Branding');
    const box = await within(sec).findByTestId('salon-logo-setting');
    await within(box).findByText('No logo yet');
    fireEvent.change(within(box).getByLabelText('Salon logo file'), { target: { files: [new File(['x'], 'tiny.png', { type: 'image/png' })] } });
    expect((await within(box).findByRole('alert')).textContent).toMatch(/too small/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(within(box).queryByAltText('Salon logo')).toBeNull();
  });

  it('the server\'s refusal is shown as it is', async () => {
    prep.prepareLogo.mockResolvedValue({ dataUrl: 'data:image/png;base64,AAAA', width: 64, height: 64, bytes: 3, type: 'image/png' });
    failUpload = 'Only PNG, JPEG or WebP images can be used as the logo.';
    const sec = await open('Receipts & Branding');
    const box = await within(sec).findByTestId('salon-logo-setting');
    await within(box).findByText('No logo yet');
    fireEvent.change(within(box).getByLabelText('Salon logo file'), { target: { files: [new File(['x'], 'l.png', { type: 'image/png' })] } });
    expect((await within(box).findByRole('alert')).textContent).toBe('Only PNG, JPEG or WebP images can be used as the logo.');
    expect(within(box).queryByAltText('Salon logo')).toBeNull();
  });
});

describe('salonLogoImage: what the browser sends', () => {
  it('only PNG, JPEG or WebP; not empty; not huge', () => {
    expect(logoPrecheck({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoPrecheck({ type: 'image/jpg', size: 1000 })).toBeNull();
    expect(logoPrecheck({ type: 'image/webp', size: 1000 })).toBeNull();
    expect(logoPrecheck({ type: 'image/svg+xml', size: 1000 })).toMatch(/PNG, JPEG or WebP/);
    expect(logoPrecheck({ type: 'image/gif', size: 1000 })).toMatch(/PNG, JPEG or WebP/);
    expect(logoPrecheck({ type: '', size: 1000 })).toMatch(/PNG, JPEG or WebP/);
    expect(logoPrecheck({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(logoPrecheck({ type: 'image/png', size: LOGO_RULES.maxSourceBytes + 1 })).toMatch(/larger than 20 MB/);
  });
  it('shrunk to fit 800 px, shape kept, never enlarged; too small or too thin is refused in plain words', () => {
    expect(logoTargetSize(3000, 1500)).toEqual({ width: 800, height: 400 });
    expect(logoTargetSize(1500, 3000)).toEqual({ width: 400, height: 800 });
    expect(logoTargetSize(300, 120)).toEqual({ width: 300, height: 120 });
    expect(() => logoTargetSize(31, 400)).toThrow(/too small \(31×400\)/);
    expect(logoTargetSize(4000, 100)).toEqual({ width: 1280, height: 32 });    // a wide wordmark keeps a readable height
    expect(() => logoTargetSize(9000, 100)).toThrow(/too long and thin/);
    for (const [w, h] of [[2400, 2400], [801, 33], [33, 801], [64, 3000]] as const) {
      const t = logoTargetSize(w, h);
      expect(Math.min(t.width, t.height)).toBeGreaterThanOrEqual(LOGO_RULES.minEdge);
      expect(Math.max(t.width, t.height)).toBeLessThanOrEqual(LOGO_RULES.maxEdge);
    }
  });
});
