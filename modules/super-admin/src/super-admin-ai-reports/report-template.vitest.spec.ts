import { describe, it, expect, beforeEach } from 'vitest';
import { ReportTemplateService, TemplateError } from './report-template.service';
import { InMemoryReportTemplateRepository } from './report-template.repository';

const sections = [{ id: 's1', title: 'Revenue', metricKeys: ['revenueCents', 'refundsCents'] }, { id: 's2', title: 'Bookings', metricKeys: ['bookings', 'ghostMetric'] }];
let repo: InMemoryReportTemplateRepository; let svc: ReportTemplateService;
beforeEach(() => { repo = new InMemoryReportTemplateRepository(); svc = new ReportTemplateService(repo); });

describe('ReportTemplateService', () => {
  it('creates versioned drafts (v1, v2) for a report key', async () => {
    const a = await svc.createDraft({ reportKey: 'daily_platform', name: 'Daily v1', sections });
    const b = await svc.createDraft({ reportKey: 'daily_platform', name: 'Daily v2', sections });
    expect(a.version).toBe(1); expect(b.version).toBe(2); expect(a.status).toBe('draft');
  });

  it('rejects an invalid template (no sections, missing name)', async () => {
    await expect(svc.createDraft({ reportKey: 'k', name: 'x', sections: [] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(svc.createDraft({ reportKey: 'k', name: '', sections })).rejects.toBeInstanceOf(TemplateError);
  });

  it('publishing archives the prior published version so one stays current', async () => {
    const v1 = await svc.createDraft({ reportKey: 'daily_platform', name: 'v1', sections });
    const v2 = await svc.createDraft({ reportKey: 'daily_platform', name: 'v2', sections });
    await svc.publish(v1.id);
    await svc.publish(v2.id);
    const current = await repo.currentPublished('daily_platform');
    expect(current!.id).toBe(v2.id);
    expect((await repo.get(v1.id))!.status).toBe('archived');
  });

  it('cannot publish a non-draft; cannot archive an archived template', async () => {
    const t = await svc.createDraft({ reportKey: 'k', name: 'x', sections });
    await svc.publish(t.id);
    await expect(svc.publish(t.id)).rejects.toMatchObject({ code: 'conflict' });
    await svc.archive(t.id);
    await expect(svc.archive(t.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('builds a GROUNDED narrative: present metrics resolve, a missing one is "—", never fabricated', async () => {
    const t = await svc.createDraft({ reportKey: 'daily_platform', name: 'v1', sections });
    await svc.publish(t.id);
    const n = await svc.buildNarrative('daily_platform', { revenueCents: 128000, refundsCents: 2000, bookings: 42 });
    expect(n.available).toBe(true);
    if (n.available) {
      expect(n.sections[0].lines[0]).toMatchObject({ key: 'revenueCents', value: 128000, grounded: true });
      const ghost = n.sections[1].lines.find((l) => l.key === 'ghostMetric')!;
      expect(ghost).toMatchObject({ value: '—', grounded: false });
      expect(n.allGrounded).toBe(false); // a referenced metric was unavailable
    }
  });

  it('signals when no template is published rather than fabricating one', async () => {
    const n = await svc.buildNarrative('daily_platform', { revenueCents: 128000 });
    expect(n.available).toBe(false);
  });
});
