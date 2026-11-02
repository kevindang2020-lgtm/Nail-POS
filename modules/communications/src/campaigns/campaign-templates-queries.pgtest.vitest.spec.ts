// campaign-templates-queries.pgtest — executes the campaign template store against the real migrated schema.
//
// A template list that silently empties reads as "no templates yet", so a Super Admin rebuilds work that
// already exists. The sharper risk is versioning: `current_version` on the template and the rows in
// `campaign_template_versions` must stay in step, or the published version and the version actually SENT
// diverge — and nothing about that looks broken from either screen.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyTemplateRepo } from './campaign-templates.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let repo: KyselyTemplateRepo;
let templateId = '';

beforeAll(async () => {
  const pg = await migratedPglite();
  repo = new KyselyTemplateRepo(kyselyFor(pg) as never);
  const t = await repo.create({ name: 'Winter promo', channel: 'email', campaignType: 'promotional', subject: 'Warm up', body: 'Hello {{name}}' } as never);
  templateId = (t as never as { id: string }).id;
});

describe('templates round-trip', () => {
  it('a created template is LISTED — an empty list means work gets rebuilt', async () => {
    expect((await repo.list({})).map((t) => t.id)).toContain(templateId);
  });

  it('get() returns it with its name intact', async () => {
    expect((await repo.get(templateId))!.name).toBe('Winter promo');
  });

  it('it starts as a draft at version 1', async () => {
    const t = (await repo.get(templateId))!;
    expect(t.status).toBe('draft');
    expect(t.currentVersion).toBe(1);
  });

  it('an unknown id returns null rather than another template', async () => {
    expect(await repo.get('deadbeef-0000-4000-8000-00000000000f')).toBeNull();
  });
});

describe('versioning — the published version and the version SENT must not diverge', () => {
  it('a new version is stored and listed', async () => {
    // The version number is DERIVED (currentVersion + 1), not supplied — passing one would be ignored, which
    // is worth knowing before writing a test that appears to control it.
    await repo.addVersion(templateId, { subject: 'Warm up v2', body: 'Hi {{name}}', published: false, createdByUserId: null } as never);
    const versions = await repo.listVersions(templateId);
    expect(versions.map((v) => v.version)).toContain(2);
  });

  it('versions are scoped to their template, not global', async () => {
    const other = await repo.create({ name: 'Other', channel: 'email', campaignType: 'promotional', subject: 's', body: 'b' } as never);
    const otherId = (other as never as { id: string }).id;
    expect((await repo.listVersions(otherId)).map((v) => v.version)).not.toContain(2);
  });

  it('publishing moves BOTH the status and current_version — a half-applied publish sends the old body', async () => {
    await repo.setStatusAndVersion(templateId, 'published', 2);
    const t = (await repo.get(templateId))!;
    expect(t.status).toBe('published');
    expect(t.currentVersion).toBe(2);
  });

  it('filtering by status finds the published one and EXCLUDES the draft', async () => {
    const published = await repo.list({ status: 'published' });
    expect(published.map((t) => t.id)).toContain(templateId);
    expect(published.every((t) => t.status === 'published')).toBe(true);
  });
});
