import { describe, it, expect } from 'vitest';
import { CampaignTemplatesService } from './campaign-templates.service';
import { InMemoryTemplateRepo } from './campaign-templates.repository';

const svc = () => new CampaignTemplatesService(new InMemoryTemplateRepo());

describe('CampaignTemplatesService', () => {
  it('rejects invalid input', async () => {
    expect((await svc().create({ name: '', channel: 'email' })).ok).toBe(false);
  });

  it('creates a draft template at version 1 with an initial version row', async () => {
    const s = svc();
    const r = await s.create({ name: "Mother's Day", channel: 'email', subject: 'Treat Mom', body: 'Book now', campaignType: 'promotional' });
    expect(r.ok).toBe(true);
    expect(r.template!.status).toBe('draft');
    expect(r.template!.currentVersion).toBe(1);
    expect(await s.versions(r.template!.id)).toHaveLength(1);
  });

  it('bumps version on edit without overwriting prior versions', async () => {
    const s = svc();
    const created = await s.create({ name: 'Summer', channel: 'email', subject: 'v1', body: 'b1' });
    const id = created.template!.id;
    const v = await s.newVersion(id, { subject: 'v2', body: 'b2', notes: 'copy tweak' });
    expect(v.ok).toBe(true);
    expect(v.version!.version).toBe(2);
    const versions = await s.versions(id);
    expect(versions).toHaveLength(2);                    // v1 preserved + v2 added
    expect(versions[0].version).toBe(2);
    expect((await s.list())[0].currentVersion).toBe(2);
  });

  it('publishes a draft and refuses to publish an archived template', async () => {
    const s = svc();
    const created = await s.create({ name: 'Promo', channel: 'sms', smsContent: 'Deal!' });
    const id = created.template!.id;
    const pub = await s.publish(id);
    expect(pub.ok).toBe(true);
    expect(pub.template!.status).toBe('published');
  });
});
