// certification-expiry.pgtest — certifications (584): own CRUD, manager verify/revoke, read-time expiry, and the
// 30/14/7-day reminder sweep (one in-app row per window, written with its bookkeeping row; past-date rows flipped to
// EXPIRED). Pure helpers first; then the real service on the real schema (every migration in PGlite). Merged Oct 12 2026
// from the other chat's certification-expiry.vitest.spec.ts. "today" is injected — no date-dependent assertions.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TechnicianCertificationsService, effectiveCertificationStatus, daysUntil, dueReminderWindow, ownSkillDocumentKey } from './technician-certifications';
import { runCertificationExpirySweep, reminderBody, certExpiryReminderEnabled } from './certification-expiry.scheduler';
import { InMemoryTechRepository } from './tech.repository';
import { TechError } from './tech-errors';

describe('pure helpers', () => {
  it('effective status: past expiry → EXPIRED (unless REVOKED); an extended date after EXPIRED needs re-verification', () => {
    expect(effectiveCertificationStatus('VERIFIED', '2026-01-01', '2026-01-02')).toBe('EXPIRED');
    expect(effectiveCertificationStatus('REVOKED', '2026-01-01', '2026-01-02')).toBe('REVOKED');
    expect(effectiveCertificationStatus('VERIFIED', '2026-01-02', '2026-01-02')).toBe('VERIFIED');
    expect(effectiveCertificationStatus('EXPIRED', '2027-01-01', '2026-01-02')).toBe('UNVERIFIED');
    expect(effectiveCertificationStatus('UNVERIFIED', null, '2026-01-02')).toBe('UNVERIFIED');
  });
  it('daysUntil is calendar arithmetic (no DST drift)', () => {
    expect(daysUntil('2026-03-15', '2026-03-01')).toBe(14);
    expect(daysUntil('2026-11-08', '2026-11-01')).toBe(7);
    expect(daysUntil(null, '2026-01-01')).toBeNull();
  });
  it('the reminder window is the tightest one containing the distance, once', () => {
    expect(dueReminderWindow(30, [30, 14, 7], new Set())).toBe(30);
    expect(dueReminderWindow(10, [30, 14, 7], new Set())).toBe(14);
    expect(dueReminderWindow(10, [30, 14, 7], new Set([14]))).toBeNull();
    expect(dueReminderWindow(31, [30, 14, 7], new Set())).toBeNull();
    expect(dueReminderWindow(-1, [30, 14, 7], new Set())).toBeNull();
  });
  it("a document key must be her own upload at this salon", () => {
    expect(ownSkillDocumentKey('tenants/t1/skill-docs/u1/abc.pdf', 't1', 'u1')).toBe(true);
    expect(ownSkillDocumentKey('tenants/t1/skill-docs/u2/abc.pdf', 't1', 'u1')).toBe(false);
    expect(ownSkillDocumentKey('tenants/t2/skill-docs/u1/abc.pdf', 't1', 'u1')).toBe(false);
    expect(ownSkillDocumentKey('tenants/t1/portfolio/u1/abc.png', 't1', 'u1')).toBe(false);
  });
  it('the env flag is off by default; the body names certification, date and window', () => {
    expect(certExpiryReminderEnabled({})).toBe(false);
    expect(certExpiryReminderEnabled({ CERT_EXPIRY_REMINDER_ENABLED: 'true' })).toBe(true);
    expect(reminderBody('Acrylic Safety', '2026-12-01', 14)).toMatch(/Acrylic Safety.*2026-12-01.*14 days/);
  });
});

const T = 'ce710000-0000-4000-8000-0000000000a0', B = 'ce710000-0000-4000-8000-0000000000b0', T2 = 'ce710000-0000-4000-8000-0000000000a9';
const MIA = 'ce710000-0000-4000-8000-00000000e001', UMIA = 'ce710000-0000-4000-8000-00000000a101', OWNER = 'ce710000-0000-4000-8000-00000000a102';
let pg: any; let db: any; let svc: TechnicianCertificationsService; let today = '2026-10-09';
const techCtx = () => ({ tenantId: T, branchId: B, userId: UMIA, role: 'TECHNICIAN' as any, permissions: [] as string[] });
const mgr = { tenantId: T, branchId: B, userId: OWNER };
const count = async (q: string, p: any[] = []) => Number((await pg.query(q, p)).rows[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','C','C','c-ce71','CE711','active'), ('${T2}','C2','C2','c2-ce71','CE712','active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main');
    INSERT INTO users (id, tenant_id, branch_id, full_name, email, status, role) VALUES ('${UMIA}','${T}','${B}','Mia C','mia@ce71.test','active','TECHNICIAN'), ('${OWNER}','${T}','${B}','Olga','o@ce71.test','active','OWNER');
    INSERT INTO technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, email, status, is_active) VALUES ('${MIA}','${T}','${B}','${UMIA}','Mia','C','Mia C','mia@ce71.test','active',true);
  `);
  const port = new InMemoryTechRepository(); (port as any).resolveTechnicianId = async () => MIA; (port as any).technicianAppEnabled = async () => true;
  svc = new TechnicianCertificationsService(db, port, () => today);
}, 300_000);

describe('certifications on the real schema', () => {
  it('a technician adds / edits her own; editing evidence drops a prior verification; a manager verifies / revokes (audited)', async () => {
    const c = await svc.createMine(techCtx(), { name: 'Acrylic Safety', issuer: 'NailPro', issuedAt: '2026-01-01', expiresAt: '2026-11-01', documentKey: `tenants/${T}/skill-docs/${UMIA}/a.pdf` });
    expect(c.verificationStatus).toBe('UNVERIFIED'); expect(c.hasDocument).toBe(true); expect(c.daysToExpiry).toBe(23);
    await expect(svc.createMine(techCtx(), { name: 'x', documentKey: `tenants/${T}/skill-docs/${OWNER}/someone-else.pdf` })).rejects.toBeInstanceOf(TechError);
    const v = await svc.verify(mgr, MIA, c.id, { status: 'VERIFIED' });
    expect(v.verificationStatus).toBe('VERIFIED'); expect(v.verifiedByUserId).toBe(OWNER);
    expect(await count(`select count(*)::int as n from technician_audit_logs where technician_id=$1 and action='technician_certification_verified'`, [MIA])).toBe(1);
    const e = await svc.updateMine(techCtx(), c.id, { expiresAt: '2027-11-01' });
    expect(e.verificationStatus).toBe('UNVERIFIED');                  // the manager verified a different fact
    await expect(svc.deleteMine(techCtx(), c.id)).resolves.toEqual({ ok: true });
    const c2 = await svc.createMine(techCtx(), { name: 'Acrylic Safety', expiresAt: '2027-11-01' });
    await svc.verify(mgr, MIA, c2.id, { status: 'VERIFIED' });
    await expect(svc.deleteMine(techCtx(), c2.id)).rejects.toBeInstanceOf(TechError);           // verified → only a manager revokes
    await expect(svc.verify(mgr, MIA, c2.id, { status: 'REVOKED' })).rejects.toBeInstanceOf(TechError);   // reason required
    const r = await svc.verify(mgr, MIA, c2.id, { status: 'REVOKED', reason: 'forged' });
    expect(r.verificationStatus).toBe('REVOKED');
    await expect(svc.verify(mgr, MIA, c2.id, { status: 'VERIFIED' })).rejects.toThrow(/revoked/);           // REVOKED is terminal
    await expect(svc.updateMine(techCtx(), c2.id, { name: 'y' })).rejects.toBeInstanceOf(TechError);
  });

  it("another salon's manager cannot see or verify a technician who is not on its roster", async () => {
    const c = await svc.createMine(techCtx(), { name: 'Pedicure Hygiene', expiresAt: '2027-05-01' });
    await expect(svc.listForTechnician(T2, MIA)).rejects.toBeInstanceOf(TechError);
    await expect(svc.verify({ tenantId: T2, branchId: '', userId: OWNER }, MIA, c.id, { status: 'VERIFIED' })).rejects.toBeInstanceOf(TechError);
  });

  it('an expired certification cannot be verified; it reads as EXPIRED', async () => {
    const c = await svc.createMine(techCtx(), { name: 'Old Cert', expiresAt: '2026-01-01' });
    expect((await svc.listMine(techCtx())).find((x) => x.id === c.id)!.verificationStatus).toBe('EXPIRED');
    await expect(svc.verify(mgr, MIA, c.id, { status: 'VERIFIED' })).rejects.toThrow(/expired/);
  });

  it('the sweep reminds at 30 / 14 / 7 days ONCE per window (in-app row) and flips past rows to EXPIRED', async () => {
    const d30 = await svc.createMine(techCtx(), { name: 'Gel Cert', expiresAt: '2026-11-08' });   // 30 days
    const d10 = await svc.createMine(techCtx(), { name: 'Wax Cert', expiresAt: '2026-10-19' });   // 10 days → the 14-day window
    const far = await svc.createMine(techCtx(), { name: 'Far Cert', expiresAt: '2027-10-19' });
    const r1 = await runCertificationExpirySweep({ certs: svc, db });
    expect(r1.expired).toBeGreaterThanOrEqual(1);                                                // 'Old Cert'
    expect((await pg.query(`select verification_status from technician_certifications where name='Old Cert'`)).rows[0].verification_status).toBe('EXPIRED');
    const windows = (await pg.query(`select certification_id, days_before from technician_certification_reminders order by days_before`)).rows;
    expect(windows).toEqual(expect.arrayContaining([{ certification_id: d30.id, days_before: 30 }, { certification_id: d10.id, days_before: 14 }]));
    expect(windows.find((w: any) => w.certification_id === far.id)).toBeUndefined();
    expect(await count(`select count(*)::int as n from technician_notifications where technician_id=$1 and type='certification_expiring'`, [MIA])).toBe(2);
    const r2 = await runCertificationExpirySweep({ certs: svc, db });                        // same day again → nothing new
    expect(r2.reminded).toBe(0);
    today = '2026-10-12';                                                                       // 7 days before Wax Cert
    const r3 = await runCertificationExpirySweep({ certs: svc, db });
    expect(r3.reminded).toBe(1);
    expect(await count(`select count(*)::int as n from technician_certification_reminders where certification_id=$1 and days_before=7`, [d10.id])).toBe(1);
    expect(await count(`select count(*)::int as n from technician_notifications where technician_id=$1 and type='certification_expiring'`, [MIA])).toBe(3);
    today = '2026-10-09';
  });

  it('a stale due list (another instance already delivered that window) sends nothing — the bookkeeping row is the claim', async () => {
    const c = await svc.createMine(techCtx(), { name: 'Race Cert', expiresAt: '2026-11-08' });
    const stale = { sweep: async () => ({ expired: 0, due: [{ certificationId: c.id, tenantId: T, technicianId: MIA, globalTechProfileId: null, name: 'Race Cert', expiresAt: '2026-11-08', daysBefore: 30 }] }) };
    const before = await count(`select count(*)::int as n from technician_notifications where reference=$1`, [c.id]);
    expect((await runCertificationExpirySweep({ certs: stale as any, db })).reminded).toBe(1);
    expect((await runCertificationExpirySweep({ certs: stale as any, db })).reminded).toBe(0);
    expect(await count(`select count(*)::int as n from technician_notifications where reference=$1`, [c.id])).toBe(before + 1);
  });
});
