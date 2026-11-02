// go-check-in-languages.vitest.spec.ts — Dual-Screen mandate §118–§119: the owner chooses the customer display's
// languages (English, Vietnamese — the default first). Refused, never guessed: an unknown language or an empty list.
import { describe, it, expect } from 'vitest';
import { InMemoryGoCheckInRepository } from './go-check-in.repository';
import { GoCheckInService } from './go-check-in.service';

const mk = () => { const repo = new InMemoryGoCheckInRepository(); return { repo, svc: new GoCheckInService(repo as any, {} as any) }; };

describe('display languages (§118–§119)', () => {
  it('English only until the owner says otherwise', async () => {
    const { svc } = mk();
    expect((await svc.getSettings('t1')).displayLanguages).toEqual(['en']);
    expect(await svc.displayLanguages('t1')).toEqual(['en']);
  });
  it("Kevin (Oct 28 2026): the customer display is English only — a saved Vietnamese choice is stored as English", async () => {
    const { svc } = mk();
    const s = await svc.updateSettings('t1', { displayLanguages: ['VI', 'en', 'vi'] });
    expect(s.displayLanguages).toEqual(['en']);
    expect(await svc.displayLanguages('t1')).toEqual(['en']);
  });
  it('any language list — unknown, empty, Vietnamese — is saved as English; nothing is refused', async () => {
    const { svc } = mk();
    for (const l of [['en', 'fr'], [], ['vi']]) expect((await svc.updateSettings('t1', { displayLanguages: l })).displayLanguages).toEqual(['en']);
    expect(await svc.displayLanguages('t1')).toEqual(['en']);
  });
  it('other toggles saved without languages leave the languages alone (English)', async () => {
    const { svc } = mk();
    await svc.updateSettings('t1', { showWaitEstimate: false });
    expect(await svc.displayLanguages('t1')).toEqual(['en']);
  });
});
