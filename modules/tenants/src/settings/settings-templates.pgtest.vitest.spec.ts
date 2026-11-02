// settings-templates.pgtest — POS → Settings → Message Templates is stored, not held in memory (gap sweep, Oct 30 2026).
// Before: GET/POST pos/settings/notifications-reminders/templates kept the list in a process Map — every restart (or a second
// API instance) lost it, and the Communications overview's template count, which reads pos_message_templates, never moved.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InMemorySettingsRepository } from './settings.repository';
import { PosSettingsService } from './settings.service';
import { KyselyMessageTemplateStore } from './settings.templates.kysely';

const T = 'e2300000-0000-4000-8000-0000000000a1', T2 = 'e2300000-0000-4000-8000-0000000000a2', B = 'e2300000-0000-4000-8000-0000000000b1';
const U = 'e2300000-0000-4000-8000-0000000000c1';
const owner: any = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
const other: any = { tenantId: T2, branchId: null, userId: U, role: 'OWNER', permissions: ['settings.view', 'settings.edit'] };
let pg: any; let db: any;
// the settings audit trail's own SQL is covered by settings-audit-entity.pgtest; here the store is the subject
const settingsRepo = new InMemorySettingsRepository();
const svcOf = () => new PosSettingsService(settingsRepo, undefined, undefined, undefined, undefined, null, null, null, null, new KyselyMessageTemplateStore(db));
const status = async (p: Promise<unknown>) => { try { await p; return 200; } catch (e: any) { return e?.status ?? e?.name ?? 'error'; } };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Tpl LLC','Tpl Salon','tpl-salon','TPL001'), ($2,'Other LLC','Other','tpl-other','TPL002')`, [T, T2]);
  await pg.query(`insert into branches (id, tenant_id, name) values ($1,$2,'Main')`, [B, T]);
}, 240_000);

describe('salon message templates are stored per salon', () => {
  it('a created template survives a new service instance (a restart) and is audited', async () => {
    const created = await svcOf().upsertTemplate(owner, { channel: 'sms', name: '  Running late ', body: 'Hi {firstName}, we are running 10 minutes late.' });
    expect(created).toMatchObject({ channel: 'sms', name: 'Running late' });
    expect(created.id).toMatch(/^tpl_[0-9a-f-]{36}$/);
    const after = await svcOf().listTemplates(owner);   // a brand-new instance: nothing in memory
    expect(after.map((t) => t.id)).toEqual([created.id]);
    const audit = await svcOf().listAudit(owner, 10);
    expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({ actionType: 'pos_message_template_created', entityId: created.id })]));
  });

  it('editing keeps the id; another salon never sees it and cannot edit it (404, nothing created)', async () => {
    const [t] = await svcOf().listTemplates(owner);
    const edited = await svcOf().upsertTemplate(owner, { id: t.id, channel: 'sms', name: 'Running late', body: 'Sorry, 15 minutes late today.' });
    expect(edited).toMatchObject({ id: t.id, body: 'Sorry, 15 minutes late today.' });
    expect(await svcOf().listTemplates(other)).toEqual([]);
    expect(await status(svcOf().upsertTemplate(other, { id: t.id, channel: 'sms', name: 'x', body: 'y' }))).toBe(404);
    expect((await pg.query(`select count(*)::int as n from pos_message_templates where id = $1`, [t.id])).rows[0].n).toBe(1);
  });

  it('refuses an empty name / body or an unknown channel', async () => {
    expect(await status(svcOf().upsertTemplate(owner, { channel: 'sms', name: ' ', body: 'x' }))).toBe('ValidationError');
    expect(await status(svcOf().upsertTemplate(owner, { channel: 'fax', name: 'a', body: 'b' }))).toBe('ValidationError');
  });
});
