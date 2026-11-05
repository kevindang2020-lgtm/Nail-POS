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
  it('the owner\'s choice is kept, cleaned — Vietnamese as the default first', async () => {
    const { svc } = mk();
    const s = await svc.updateSettings('t1', { displayLanguages: ['VI', 'en', 'vi'] });
    expect(s.displayLanguages).toEqual(['vi', 'en']);
    expect(await svc.displayLanguages('t1')).toEqual(['vi', 'en']);
  });
  it('an unknown language or an empty list is refused (400 VALIDATION_FAILED) and nothing changes', async () => {
    const { svc } = mk();
    await svc.updateSettings('t1', { displayLanguages: ['en', 'vi'] });
    await expect(svc.updateSettings('t1', { displayLanguages: ['en', 'fr'] })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    await expect(svc.updateSettings('t1', { displayLanguages: [] })).rejects.toMatchObject({ status: 400 });
    expect(await svc.displayLanguages('t1')).toEqual(['en', 'vi']);
  });
  it('other toggles saved without languages leave the languages alone', async () => {
    const { svc } = mk();
    await svc.updateSettings('t1', { displayLanguages: ['vi'] });
    await svc.updateSettings('t1', { showWaitEstimate: false });
    expect(await svc.displayLanguages('t1')).toEqual(['vi']);
  });
});
