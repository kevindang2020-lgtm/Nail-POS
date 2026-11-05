import { describe, it, expect } from 'vitest';
import { SuperAdminPlatformService } from './super-admin-platform.service';
import { InMemorySuperAdminPlatformRepo } from './super-admin-platform.repository';
import { canTransitionApplication, APPLICATION_STATUSES } from './applications-lifecycle-core';
import { encryptField } from './field-encryption';

// Phase 3 of the Free-POS-Package intake spec: the review lifecycle. Status changes are TRANSITION-ENFORCED
// (16 canonical statuses + the 3 legacy values already in production rows), approval requires a note and
// revalidates tenant linkage, rejection requires a reason, every workflow action appends a history note and
// bumps record_version, and the EIN decrypts only through the audited, permission-gated reveal path.
const ctx: any = { userId: 'sa-1', role: 'SUPER_ADMIN' };
function svc() { const repo = new InMemorySuperAdminPlatformRepo(); return { repo, s: new SuperAdminPlatformService(repo) }; }
async function seed(repo: InMemorySuperAdminPlatformRepo, over: any = {}) {
  return (repo as any).createApplication({ salon_name: 'Lotus', owner_name: 'Linda Pham', email: 'l@l.com', phone: '6095550188', reference_number: 'APS-TEST-0001', record_version: 1, ...over });
}

describe('application transition table', () => {
  it('permits the review flow and blocks nonsense', () => {
    expect(canTransitionApplication('new', 'under_review')).toBe(true);
    expect(canTransitionApplication('under_review', 'qualified')).toBe(true);
    expect(canTransitionApplication('qualified', 'approved')).toBe(true);
    expect(canTransitionApplication('approved', 'converted_onboarding')).toBe(true);
    expect(canTransitionApplication('converted_onboarding', 'converted_tenant')).toBe(true);
    expect(canTransitionApplication('converted_tenant', 'new')).toBe(false);
    expect(canTransitionApplication('approved', 'rejected')).toBe(false);
    expect(canTransitionApplication('rejected', 'under_review')).toBe(true); // reopen path
    expect(canTransitionApplication('archived', 'under_review')).toBe(false); // terminal
    expect(canTransitionApplication('new', 'new')).toBe(false);
  });
  it('legacy statuses (reviewing, demo_scheduled, converted) remain first-class', () => {
    expect(APPLICATION_STATUSES.includes('reviewing' as any)).toBe(true);
    expect(canTransitionApplication('reviewing', 'approved')).toBe(true);
    expect(canTransitionApplication('demo_scheduled', 'qualified')).toBe(true);
    expect(canTransitionApplication('approved', 'converted')).toBe(true);
    expect(canTransitionApplication('converted', 'archived')).toBe(true);
  });
});

describe('review workflow (service)', () => {
  it('status changes are transition-enforced and write history + stamps + version bump', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'new' });
    await s.setApplicationStatus(ctx, a.id, 'under_review');
    await expect(s.setApplicationStatus(ctx, a.id, 'converted_tenant')).rejects.toThrow(/Cannot move/);
    const row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('under_review');
    expect(row.record_version).toBe(2);
    expect(row.notes.some((n: any) => n.text.includes('Status: new'))).toBe(true);
  });
  it('approve REQUIRES a note, stamps approved_at, keeps the hardware side effect, and blocks if already linked', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'qualified' });
    await expect(s.approveApplication(ctx, a.id, { note: '' })).rejects.toThrow(/note is required/);
    await s.approveApplication(ctx, a.id, { note: 'Verified volume + location on call' });
    const row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('approved');
    expect(row.approved_at).toBeTruthy();
    expect((repo as any).hw.length).toBe(1); // existing Approve-Package hardware record still created
    const b = await seed(repo, { status: 'qualified', converted_tenant_id: 'ten_1', reference_number: 'APS-TEST-0002' });
    await expect(s.approveApplication(ctx, b.id, { note: 'x-note' })).rejects.toThrow(/already linked/);
  });
  it('reject REQUIRES a reason and stamps rejected_at; archive stamps archived_at and is terminal', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'under_review' });
    await expect(s.rejectApplication(ctx, a.id, { reason: '' })).rejects.toThrow(/reason is required/);
    await s.rejectApplication(ctx, a.id, { reason: 'Outside service area' });
    let row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('rejected'); expect(row.rejected_at).toBeTruthy();
    expect(row.notes.some((n: any) => n.text.includes('Outside service area'))).toBe(true);
    await s.archiveApplication(ctx, a.id);
    row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('archived'); expect(row.archived_at).toBeTruthy();
    await expect(s.setApplicationStatus(ctx, a.id, 'under_review')).rejects.toThrow(/Cannot move/);
  });
  it('assign / priority / follow-up / contact-log validate input and leave a trail', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'new' });
    await s.assignApplication(ctx, a.id, 'sa-9');
    await expect(s.setApplicationPriority(ctx, a.id, 'mega')).rejects.toThrow(/priority/);
    await s.setApplicationPriority(ctx, a.id, 'high');
    await expect(s.scheduleApplicationFollowUp(ctx, a.id, 'not-a-date')).rejects.toThrow(/valid date/);
    await s.scheduleApplicationFollowUp(ctx, a.id, '2026-08-01T15:00:00Z');
    await expect(s.logApplicationContact(ctx, a.id, { channel: 'fax' })).rejects.toThrow(/channel/);
    await s.logApplicationContact(ctx, a.id, { channel: 'phone', note: 'Left voicemail' });
    const row = await (repo as any).getApplication(a.id);
    expect(row.assigned_to_user_id).toBe('sa-9');
    expect(row.priority).toBe('high');
    expect(String(row.follow_up_at?.toISOString?.() ?? row.follow_up_at)).toContain('2026-08-01');
    expect(row.last_contacted_at).toBeTruthy();
    expect(row.notes.some((n: any) => n.text.includes('Left voicemail'))).toBe(true);
    expect(row.record_version).toBe(5); // seed starts at 1; four workflow touches
  });
  it('duplicate/spam marks route through the transition table with an optional reason', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'new' });
    await s.markApplicationDuplicate(ctx, a.id, { reason: 'Same EIN as APS-X' });
    let row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('duplicate');
    await s.setApplicationStatus(ctx, a.id, 'under_review'); // false positive reopened
    await s.markApplicationSpam(ctx, a.id);
    row = await (repo as any).getApplication(a.id);
    expect(row.status).toBe('spam');
  });
  it('approval \u2192 onboarding: opens the onboarding case, links it, keeps the application as the immutable source', async () => {
    const repo = new InMemorySuperAdminPlatformRepo();
    const calls: any[] = [];
    const onboarding = { createApplication: async (_c: any, input: any) => { calls.push(input); return { id: 'ob_1', currentStage: 'application_received' }; } };
    const s = new SuperAdminPlatformService(repo as any, undefined, onboarding as any);
    const a = await seed(repo, { status: 'approved', priority: 'high', assigned_to_user_id: 'sa-7' });
    const r = await s.convertApplicationToOnboarding(ctx, a.id);
    expect(r.status).toBe('converted_onboarding');
    expect(r.onboarding_id).toBe('ob_1');
    expect(calls[0]).toMatchObject({ applicationId: a.id, applicationType: 'new_tenant', priority: 'high', specialistUserId: 'sa-7' });
    // no processor/hardware credentials in the conversion payload (spec: not until the authorized stage)
    expect(Object.keys(calls[0]).sort()).toEqual(['applicationId', 'applicationType', 'priority', 'specialistUserId']);
    const row = await (repo as any).getApplication(a.id);
    expect(row.salon_name).toBe('Lotus'); // source record untouched
    expect(row.notes.some((n: any) => n.text.includes('onboarding ob_1'))).toBe(true);
    // double-start blocked by the linkage guard
    await expect(s.convertApplicationToOnboarding(ctx, a.id)).rejects.toThrow(/Cannot start onboarding|already/);
  });
  it('conversion is transition-guarded (approve first) and honest when onboarding is not wired', async () => {
    const repo = new InMemorySuperAdminPlatformRepo();
    const onboarding = { createApplication: async () => ({ id: 'ob_2' }) };
    const s = new SuperAdminPlatformService(repo as any, undefined, onboarding as any);
    const a = await seed(repo, { status: 'new' });
    await expect(s.convertApplicationToOnboarding(ctx, a.id)).rejects.toThrow(/approve the application first/);
    const bare = new SuperAdminPlatformService(repo as any);
    const b = await seed(repo, { status: 'approved', reference_number: 'APS-TEST-0009' });
    await expect(bare.convertApplicationToOnboarding(ctx, b.id)).rejects.toThrow(/not available/);
  });
  it('Mark Converted (tenant) is now transition-enforced and rejects relinking to a different tenant', async () => {
    const { repo, s } = svc();
    const a = await seed(repo, { status: 'new' });
    await expect(s.markApplicationConverted(ctx, a.id, 'ten_9')).rejects.toThrow(/Cannot move/);
    const b = await seed(repo, { status: 'approved', reference_number: 'APS-TEST-0010' });
    await s.markApplicationConverted(ctx, b.id, 'ten_9');
    const row = await (repo as any).getApplication(b.id);
    expect(row.status).toBe('converted');
    expect(row.converted_tenant_id).toBe('ten_9');
    const c = await seed(repo, { status: 'approved', converted_tenant_id: 'ten_1', reference_number: 'APS-TEST-0011' });
    await expect(s.markApplicationConverted(ctx, c.id, 'ten_2')).rejects.toThrow(/already linked/);
  });
  it('Mark Converted links the onboarding case to the new tenant (wave 4 PILOT: the case kept tenantId null forever)', async () => {
    const repo = new InMemorySuperAdminPlatformRepo();
    const linked: any[] = [];
    const onboarding = { createApplication: async () => ({ id: 'ob_7' }), linkTenant: async (_c: any, id: string, tenantId: string) => { linked.push([id, tenantId]); } };
    const s = new SuperAdminPlatformService(repo as any, undefined, onboarding as any);
    const a = await seed(repo, { status: 'approved', reference_number: 'APS-TEST-0012' });
    await s.convertApplicationToOnboarding(ctx, a.id);
    await s.markApplicationConverted(ctx, a.id, 'ten_7');
    expect(linked).toEqual([['ob_7', 'ten_7']]);
    // an application converted without an onboarding case links nothing (and an older onboarding port without linkTenant is fine)
    const b = await seed(repo, { status: 'approved', reference_number: 'APS-TEST-0013' });
    await s.markApplicationConverted(ctx, b.id, 'ten_8');
    expect(linked.length).toBe(1);
  });
  it('metrics: real aggregation, honest nulls, overdue follow-ups only for OPEN applications', async () => {
    const { repo, s } = svc();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await seed(repo, { status: 'new', source: 'website', state: 'NJ', card_volume_band: '$25k\u2013$50k', current_pos: 'Clover', current_processor: 'Fiserv' });
    await seed(repo, { status: 'under_review', state: 'NJ', assigned_to_user_id: 'sa-3', follow_up_at: new Date(Date.now() - 86_400_000), duplicate_risk_score: 50, reference_number: 'APS-M-2' });
    await seed(repo, { status: 'approved', created_at: old, approved_at: new Date(new Date(old).getTime() + 48 * 3_600_000), reference_number: 'APS-M-3' });
    await seed(repo, { status: 'archived', follow_up_at: new Date(Date.now() - 86_400_000), reference_number: 'APS-M-4' }); // overdue but CLOSED \u2192 not counted
    await seed(repo, { status: 'converted_tenant', reference_number: 'APS-M-5' });
    const m = await s.applicationMetrics(ctx);
    expect(m.total).toBe(5);
    expect(m.byStatus['new']).toBe(1);
    expect(m.open).toBe(2);
    expect(m.followUpsOverdue).toBe(1);
    expect(m.duplicatesFlagged).toBe(1);
    expect(m.converted).toBe(1);
    expect(m.conversionRatePct).toBe(20);
    expect(m.avgApprovalHours).toBe(48);
    expect(m.avgFirstResponseHours).toBeNull(); // only the LATEST contact is stored \u2014 a first-response avg would be dishonest
    expect(m.reviewerWorkload).toEqual([{ key: 'sa-3', count: 1 }]);
    expect(m.bySource[0]).toEqual({ key: 'website', count: 1 });
    expect(m.byState[0]).toEqual({ key: 'NJ', count: 2 });
    expect(m.received30).toBe(4); // the 40-day-old approved row is outside the window
  });
  it('metrics: empty dataset returns zeros/nulls (never fabricated numbers)', async () => {
    const { s } = svc();
    const m = await s.applicationMetrics(ctx);
    expect(m.total).toBe(0);
    expect(m.conversionRatePct).toBeNull();
    expect(m.avgApprovalHours).toBeNull();
    expect(m.bySource).toEqual([]);
  });
  it('EIN reveal decrypts only via the audited path and is honest when no key/EIN exists', async () => {
    process.env.APP_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    try {
      const { repo, s } = svc();
      const a = await seed(repo, { status: 'new', ein_encrypted: encryptField('12-3456789'), ein_last4: '6789' });
      const out = await s.revealApplicationEin(ctx, a.id);
      expect(out).toMatchObject({ ok: true, ein: '12-3456789', last4: '6789' });
      const b = await seed(repo, { status: 'new', ein_last4: '4321', reference_number: 'APS-TEST-0003' });
      const noKeyAtIntake = await s.revealApplicationEin(ctx, b.id);
      expect(noKeyAtIntake.ein).toBeNull();
      expect(noKeyAtIntake.last4).toBe('4321');
    } finally { delete process.env.APP_DATA_ENCRYPTION_KEY; }
  });
});
