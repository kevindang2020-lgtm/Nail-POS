// platform-notice-core — the pure rules (Oct 22 2026 mandate): plain text only, deterministic order, derived status,
// schedule validation, confirmation, material change, the lifecycle machine.
import { describe, it, expect } from 'vitest';
import { assertTransition } from '@aipowersalon/database';
import { cleanMessage, cleanTitle, derivedStatus, windowProblem, compareForDisplay, needsConfirmation, isMaterialChange, PLATFORM_NOTICE, cleanVietnamese, isCriticalNotice, viProblem } from './platform-notice-core';
import { announcementText } from '@aipowersalon/api-contracts/tenant';

describe('plain text (§49, §89, §94)', () => {
  it('normalizes line endings, removes control / bidi characters, collapses blank runs, trims', () => {
    expect(cleanMessage('a\r\nb\rc\u0000\u202e\n\n\n\nd \t')).toEqual({ ok: true, value: 'a\nb\nc\n\nd' });
  });
  it('refuses markup and script schemes rather than silently changing the text', () => {
    for (const s of ['<script>x</script>', '<a href="x">y</a>', '<img src=x>', 'see javascript:void(0)', 'data:text/html,<p>', '</div>']) expect(cleanMessage(s).ok).toBe(false);
    expect(cleanMessage('5 < 7 and 8 > 3 are fine').ok).toBe(true);
  });
  it('refuses empty and over-long messages; titles are one line', () => {
    expect(cleanMessage('   ').ok).toBe(false);
    expect(cleanMessage('x'.repeat(2001)).ok).toBe(false);
    expect(cleanMessage('x'.repeat(2000)).ok).toBe(true);
    expect(cleanTitle('Maintenance:\nTonight')).toEqual({ ok: true, value: 'Maintenance: Tonight' });
    expect(cleanTitle('   ')).toEqual({ ok: true, value: null });
  });
});

describe('status, schedule, order', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  it('derives scheduled / active / expired from the window; stored states pass through', () => {
    expect(derivedStatus({ lifecycle: 'published', startsAt: '2026-10-22T13:00:00Z', endsAt: null }, now)).toBe('scheduled');
    expect(derivedStatus({ lifecycle: 'published', startsAt: '2026-10-22T11:00:00Z', endsAt: '2026-10-22T12:30:00Z' }, now)).toBe('active');
    expect(derivedStatus({ lifecycle: 'published', startsAt: null, endsAt: '2026-10-22T12:00:00Z' }, now)).toBe('expired');
    for (const s of ['draft', 'paused', 'archived']) expect(derivedStatus({ lifecycle: s, startsAt: null, endsAt: null }, now)).toBe(s);
  });
  it('validates the window (§93) and requires an end for maintenance (§58–§59)', () => {
    expect(windowProblem({ startsAt: 10, endsAt: 5, type: 'info' }, 0, false)).toMatch(/after the start/);
    expect(windowProblem({ startsAt: null, endsAt: now - 1, type: 'info' }, now, true)).toMatch(/passed/);
    expect(windowProblem({ startsAt: null, endsAt: null, type: 'maintenance' }, now, true)).toMatch(/end time/);
    expect(windowProblem({ startsAt: null, endsAt: null, type: 'maintenance' }, now, false)).toBeNull();   // a draft may still be incomplete
  });
  it('orders critical > high > normal > low, then newest, then id — the same on every client (§43)', () => {
    const items = [
      { id: 'b', priority: 'normal', publishedAt: '2026-10-22T10:00:00Z' }, { id: 'a', priority: 'normal', publishedAt: '2026-10-22T10:00:00Z' },
      { id: 'c', priority: 'low', publishedAt: '2026-10-22T11:00:00Z' }, { id: 'd', priority: 'critical', publishedAt: '2026-10-21T10:00:00Z' },
      { id: 'e', priority: 'normal', publishedAt: '2026-10-22T11:00:00Z' }, { id: 'f', priority: 'high', publishedAt: null },
    ];
    expect([...items].sort(compareForDisplay).map((i) => i.id)).toEqual(['d', 'f', 'e', 'a', 'b', 'c']);
  });
  it('asks for confirmation for every salon at once or a high / critical message (§120–§121)', () => {
    expect(needsConfirmation({ audience: 'all_tenants', priority: 'low' })).toBe(true);
    expect(needsConfirmation({ audience: 'selected_tenants', priority: 'high' })).toBe(true);
    expect(needsConfirmation({ audience: 'selected_branches', priority: 'normal' })).toBe(false);
  });
  it('a material change is what the salon reads; the schedule is not (§133)', () => {
    const base = { title: null, message: 'm', type: 'info', priority: 'normal' };
    expect(isMaterialChange(base, { ...base })).toBe(false);
    expect(isMaterialChange(base, { ...base, message: 'n' })).toBe(true);
    expect(isMaterialChange(base, { ...base, priority: 'high' })).toBe(true);
  });
  it('archive is terminal; a draft cannot be paused', () => {
    expect(() => assertTransition(PLATFORM_NOTICE, 'archived', 'published')).toThrow();
    expect(() => assertTransition(PLATFORM_NOTICE, 'draft', 'paused')).toThrow();
    expect(() => assertTransition(PLATFORM_NOTICE, 'paused', 'published')).not.toThrow();
  });
});

describe('Vietnamese version (English + Vietnamese POS mandate WP-F, §56–§57)', () => {
  it('cleans like the English, keeps every Vietnamese diacritic, and refuses a title without its message', () => {
    expect(cleanVietnamese(' Bảo trì ', 'Thanh toán thẻ\r\nsẽ chậm.')).toEqual({ ok: true, value: { titleVi: 'Bảo trì', messageVi: 'Thanh toán thẻ\nsẽ chậm.' } });
    expect(cleanVietnamese(null, '   ')).toEqual({ ok: true, value: { titleVi: null, messageVi: null } });
    expect(cleanVietnamese('Tiêu đề', null).ok).toBe(false);
    expect(cleanVietnamese(null, '<b>Xin chào</b>').ok).toBe(false);
  });
  it('critical = maintenance / warning / urgent or critical priority; it needs a REVIEWED Vietnamese version or English only — never both', () => {
    expect(isCriticalNotice({ type: 'info', priority: 'high' })).toBe(false);
    for (const x of [{ type: 'maintenance', priority: 'low' }, { type: 'warning', priority: 'normal' }, { type: 'urgent', priority: 'normal' }, { type: 'info', priority: 'critical' }]) expect(isCriticalNotice(x)).toBe(true);
    const c = { type: 'urgent', priority: 'normal' };
    expect(viProblem({ ...c, messageVi: null, viReviewed: false, englishOnly: false })).toMatch(/reviewed Vietnamese version/);
    expect(viProblem({ ...c, messageVi: 'x', viReviewed: false, englishOnly: false })).toMatch(/Review the Vietnamese/);
    expect(viProblem({ ...c, messageVi: 'x', viReviewed: true, englishOnly: false })).toBeNull();
    expect(viProblem({ ...c, messageVi: null, viReviewed: false, englishOnly: true })).toBeNull();
    expect(viProblem({ ...c, messageVi: 'x', viReviewed: false, englishOnly: true })).toMatch(/English only/);
    expect(viProblem({ type: 'info', priority: 'normal', messageVi: null, viReviewed: false, englishOnly: false })).toBeNull();   // optional for the rest
  });
  it('a Vietnamese text change is material; the POS shows Vietnamese only when it is in Vietnamese AND a version exists', () => {
    const base = { title: 'T', message: 'M', type: 'info', priority: 'normal', titleVi: null, messageVi: 'Một' };
    expect(isMaterialChange(base, { ...base, messageVi: 'Hai' })).toBe(true);
    expect(isMaterialChange(base, { ...base })).toBe(false);
    const a = { title: 'Update', message: 'English text', titleVi: 'Cập nhật', messageVi: 'Nội dung' };
    expect(announcementText(a, 'vi')).toEqual({ title: 'Cập nhật', message: 'Nội dung', language: 'vi' });
    expect(announcementText(a, 'en')).toEqual({ title: 'Update', message: 'English text', language: 'en' });
    expect(announcementText({ ...a, titleVi: null, messageVi: null }, 'vi')).toEqual({ title: 'Update', message: 'English text', language: 'en' });
  });
});
