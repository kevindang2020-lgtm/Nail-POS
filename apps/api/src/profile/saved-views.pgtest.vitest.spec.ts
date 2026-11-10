// saved-views.pgtest — POS saved views (extras arc, Nov 9 2026) on the REAL schema: my own views per screen, one default,
// name uniqueness, the 20-view limit, bad filters refused, and nobody else's views (another person, another salon).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SavedViews } from './saved-views';

const P = 'c8440000-0000-4000-8000-'; const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), X = id(2), U = id(3), U2 = id(4);
const me = { tenantId: T, userId: U }, colleague = { tenantId: T, userId: U2 }, otherSalon = { tenantId: X, userId: U };
let db: any; let svc: SavedViews;
const S = 'money-protection.alerts';

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new SavedViews(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'sv-844', 'SV844', 'active'), (${X}, 'X', 'Other', 'sv-844x', 'SV844X', 'active')`.execute(db);
});

describe('POS saved views', () => {
  it('saves, lists (default first) and opens my own views for one screen', async () => {
    await svc.create(me, { surface: S, name: 'Critical', filters: { severity: 'critical', status: 'open', pageSize: 25 } });
    const d = await svc.create(me, { surface: S, name: 'My cases', filters: { assignee: 'me', statuses: ['open', 'review'] }, isDefault: true });
    const l = await svc.list(me, S);
    expect(l.items.map((v) => v.name)).toEqual(['My cases', 'Critical']);
    expect(l.items[0]).toMatchObject({ id: d.id, isDefault: true, filters: { assignee: 'me', statuses: ['open', 'review'] } });
    expect(l.limit).toBe(20);
  });
  it('only one default per screen: making another the default clears the first', async () => {
    const crit = (await svc.list(me, S)).items.find((v) => v.name === 'Critical')!;
    await svc.update(me, crit.id, { isDefault: true });
    const l = await svc.list(me, S);
    expect(l.items.filter((v) => v.isDefault).map((v) => v.name)).toEqual(['Critical']);
  });
  it('names are unique per screen (case and spaces ignored); renames and filter edits keep the rest', async () => {
    await expect(svc.create(me, { surface: S, name: '  critical ', filters: {} })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_NAME_TAKEN' });
    const mine = (await svc.list(me, S)).items.find((v) => v.name === 'My cases')!;
    const r = await svc.update(me, mine.id, { name: 'Assigned to me' });
    expect(r).toMatchObject({ name: 'Assigned to me', filters: { assignee: 'me' } });
    expect((await svc.update(me, mine.id, { filters: { assignee: 'me', branch: 'b1' } })).filters).toEqual({ assignee: 'me', branch: 'b1' });
    // the same name on ANOTHER screen is fine
    expect((await svc.create(me, { surface: 'appointments.history', name: 'Critical', filters: {} })).surface).toBe('appointments.history');
  });
  it('refuses bad input: unknown screen key, empty name, nested or oversized filters', async () => {
    await expect(svc.create(me, { surface: 'Bad Screen!', name: 'x', filters: {} })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_INVALID' });
    await expect(svc.create(me, { surface: S, name: '   ', filters: {} })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_INVALID' });
    await expect(svc.create(me, { surface: S, name: 'n', filters: { deep: { a: 1 } } })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_INVALID' });
    await expect(svc.create(me, { surface: S, name: 'n', filters: { q: 'x'.repeat(201) } })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_INVALID' });
    await expect(svc.create(me, { surface: S, name: 'n', filters: ['a'] })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_INVALID' });
  });
  it('nobody else can see, change or delete my views — a colleague, or me in another salon', async () => {
    const mine = (await svc.list(me, S)).items[0];
    expect((await svc.list(colleague, S)).items).toEqual([]);
    expect((await svc.list(otherSalon, S)).items).toEqual([]);
    await expect(svc.update(colleague, mine.id, { name: 'hijack' })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_NOT_FOUND' });
    await expect(svc.remove(otherSalon, mine.id)).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_NOT_FOUND' });
    expect((await svc.list(me, S)).items.find((v) => v.id === mine.id)?.name).toBe(mine.name);
  });
  it('at most 20 views per screen; delete frees a slot', async () => {
    const s2 = 'customers.directory';
    for (let i = 0; i < 20; i++) await svc.create(me, { surface: s2, name: `v${i}`, filters: { i } });
    await expect(svc.create(me, { surface: s2, name: 'v20', filters: {} })).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_LIMIT' });
    const first = (await svc.list(me, s2)).items[0];
    expect(await svc.remove(me, first.id)).toEqual({ deleted: true });
    expect((await svc.create(me, { surface: s2, name: 'v20', filters: {} })).name).toBe('v20');
    await expect(svc.remove(me, first.id)).rejects.toMatchObject({ apiCode: 'SAVED_VIEW_NOT_FOUND' });
  });
});
