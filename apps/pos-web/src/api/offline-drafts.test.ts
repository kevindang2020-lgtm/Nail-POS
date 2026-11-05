// offline-drafts.test.ts — Decision 33 draft notes: per-user storage, one draft per record keeping the ORIGINAL base,
// 7-day expiry, and the reconnect check in the decision's order (authenticate → refresh → validate).
import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, listDrafts, removeDraft, setDraftScope, checkDraft, isOfflineFailure } from './offline-drafts';

const base = { salonNotes: 'Likes almond shape', allergyNotes: '' };
const typed = { salonNotes: 'Likes almond shape. Gel allergy suspected.', allergyNotes: 'Possible gel sensitivity' };
beforeEach(() => { localStorage.clear(); setDraftScope('t1:b1:u1'); });

describe('draft store', () => {
  it('keeps drafts per user — another user signing in sees none; no scope stores nothing', () => {
    saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'Grace', payload: typed, base });
    expect(listDrafts()).toHaveLength(1);
    setDraftScope('t1:b1:u2'); expect(listDrafts()).toEqual([]);
    setDraftScope(''); expect(saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'G', payload: typed, base })).toBeNull();
    setDraftScope('t1:b1:u1'); expect(listDrafts()).toHaveLength(1);
  });
  it('with nobody signed in, no drafts are listed — even if something sits under the unscoped key', () => {
    localStorage.setItem('aps_offline_drafts:', JSON.stringify([{ id: 'x', kind: 'customer_notes', targetId: 'c9', label: 'Someone', payload: typed, base, savedAt: Date.now() }]));
    setDraftScope('');
    expect(listDrafts()).toEqual([]);
  });
  it('a second offline save of the same record replaces the text but keeps the ORIGINAL base', () => {
    saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'Grace', payload: { salonNotes: 'v1' }, base });
    saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'Grace', payload: { salonNotes: 'v2' }, base: { salonNotes: 'v1' } });
    const all = listDrafts();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ payload: { salonNotes: 'v2' }, base });
  });
  it('drafts older than 7 days are dropped; remove deletes', () => {
    saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'G', payload: typed, base }, localStorage, 0);
    expect(listDrafts(localStorage, 8 * 86_400_000)).toEqual([]);
    const d = saveDraft({ kind: 'customer_notes', targetId: 'c2', label: 'H', payload: typed, base })!;
    removeDraft(d.id); expect(listDrafts()).toEqual([]);
  });
});

describe('checkDraft — authenticate → refresh → validate', () => {
  const d = () => saveDraft({ kind: 'customer_notes', targetId: 'c1', label: 'Grace', payload: typed, base })!;
  const ok = { online: () => true, whoAmI: async () => ({ userId: 'u1' }), fetchCurrent: async () => ({ ...base }) };
  it('ready when the server still has what the draft started from', async () => { expect(await checkDraft(d(), ok)).toEqual({ status: 'ready' }); });
  it('conflict when someone changed the notes on another device meanwhile', async () => {
    expect(await checkDraft(d(), { ...ok, fetchCurrent: async () => ({ ...base, salonNotes: 'Edited at the desk' }) })).toMatchObject({ status: 'conflict', current: { salonNotes: 'Edited at the desk' } });
  });
  it('signed out stops before reading anything; offline / gone are reported', async () => {
    let fetched = false;
    expect(await checkDraft(d(), { ...ok, whoAmI: async () => { throw new Error('401'); }, fetchCurrent: async () => { fetched = true; return base; } })).toEqual({ status: 'signed_out' });
    expect(fetched).toBe(false);
    expect(await checkDraft(d(), { ...ok, online: () => false })).toEqual({ status: 'offline' });
    expect(await checkDraft(d(), { ...ok, fetchCurrent: async () => { throw Object.assign(new Error('nf'), { status: 404 }); } })).toEqual({ status: 'gone' });
  });
  it('isOfflineFailure recognises the network-layer refusal and a dead connection, not a permission error', () => {
    expect(isOfflineFailure(Object.assign(new Error('You are offline…'), { code: 'OFFLINE', status: 503 }))).toBe(true);
    expect(isOfflineFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOfflineFailure(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(false);
  });
});
