/* verify-super-admin-platform.ts — proves the new Super Admin platform module over real Postgres (PGlite):
 * website lead -> convert to tenant application -> qualify/approve (approval auto-opens a hardware package) ->
 * hardware lifecycle -> mark converted to a real tenant id -> support-access sessions (mandatory reason + time
 * limit, end session) -> every mutation lands in audit_logs -> state endpoint counts. */
import { KyselySettingsRepository } from '../../../modules/tenants/src/settings/settings.kysely.repository';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { KyselySuperAdminPlatformRepo } from '../../../modules/super-admin/src/super-admin-platform/super-admin-platform.repository';
import { SuperAdminPlatformService, PlatformError } from '../../../modules/super-admin/src/super-admin-platform/super-admin-platform.service';
import { hashPassword } from '../../../packages/auth/src/password';
import { encryptSecret } from '../src/common/mfa-enc';
import { generateSecret, totpCode } from '../../../modules/identity/src/auth/totp';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); c ? pass++ : fail++; };
const threw = async (fn: () => Promise<any>, code: string) => { try { await fn(); return false; } catch (e) { return e instanceof PlatformError && e.code === code; } };
const ctx = { userId: '00000000-0000-0000-0000-00000ad01001', email: 'kevin@aipowersalon.com' };

(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { applyMigrationToPglite } = await import('../db/migration-sql.mjs');   // Phase 10: no-transaction / CONCURRENTLY rules
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  for (const f of readdirSync(join(process.cwd(), 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) await applyMigrationToPglite(db, readFileSync(join(process.cwd(), 'db', 'migrations', f), 'utf8'));
  const server = new PGLiteSocketServer({ db, port: 5498, host: '127.0.0.1' }); await server.start();
  const k = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5498/postgres' }) }) });
  const svc = new SuperAdminPlatformService(new KyselySuperAdminPlatformRepo(k), k);
  // the acting super admin exists as a REAL user (step-up verifies against their stored scrypt hash)
  const ADMIN_PW = 'Sup3r-Pass!';
  await k.insertInto('users' as any).values({ id: ctx.userId, tenant_id: null, full_name: 'Kevin Dang', email: ctx.email, password_hash: await hashPassword(ADMIN_PW), status: 'active', role: 'SUPER_ADMIN' } as any).execute();

  // 1) website lead arrives (as the public site would create it)
  const lead = await svc.createLead(ctx, { kind: 'free_package', name: 'Emily Johnson', salon_name: 'Glow Nail Spa', phone: '(512) 555-8765', email: 'emily@glow.com', city: 'Austin', state: 'TX', source_page: '/free-package' });
  ok('lead created (free_package, status new)', lead?.status === 'new' && lead?.kind === 'free_package', `${lead?.kind}/${lead?.status}`);
  ok('bogus lead status rejected', await threw(() => svc.setLeadStatus(ctx, String(lead.id), 'closed_won'), 'invalid'));

  // 2) convert lead -> application; lead links to the application
  const conv = await svc.convertLead(ctx, String(lead.id));
  ok('lead converts to a tenant application carrying contact fields', conv.application?.salon_name === 'Glow Nail Spa' && conv.lead?.status === 'converted_to_application' && String(conv.lead?.application_id) === String(conv.application?.id), `${conv.application?.salon_name}`);
  ok('double-convert is rejected', await threw(() => svc.convertLead(ctx, String(lead.id)), 'invalid'));
  const appId = String(conv.application.id);

  // 3) review pipeline; APPROVAL auto-opens the hardware package with the preferred iMac color
  await svc.setApplicationStatus(ctx, appId, 'reviewing');
  await k.updateTable('tenant_applications' as any).set({ preferred_imac_color: 'Gold' } as any).where('id', '=', appId as any).execute();
  await svc.setApplicationStatus(ctx, appId, 'qualified');
  const approved = await svc.setApplicationStatus(ctx, appId, 'approved');
  ok('application approved', approved?.status === 'approved');
  const hwList = await svc.hardware({ page: 1, pageSize: 10 });
  const hw = hwList.rows.find((h: any) => String(h.application_id) === appId);
  ok('approval auto-created a hardware package (pending_approval, color carried)', !!hw && hw.status === 'pending_approval' && hw.imac_color === 'Gold', JSON.stringify({ s: hw?.status, c: hw?.imac_color }));

  // 4) hardware lifecycle with guarded transitions + serials + delivered/activated timestamps
  ok('bad hardware status rejected', await threw(() => svc.updateHardware(ctx, String(hw.id), { status: 'shipped' }), 'invalid'));
  await svc.updateHardware(ctx, String(hw.id), { status: 'ordered', imac_serial: 'IMAC-001', clover_flex_serial: 'FLEX-77', agreement_status: 'signed', payment_setup_status: 'complete' });
  const delivered = await svc.updateHardware(ctx, String(hw.id), { status: 'delivered' });
  ok('delivered sets delivered_at', !!delivered?.delivered_at, String(delivered?.delivered_at));
  const activated = await svc.updateHardware(ctx, String(hw.id), { status: 'activated' });
  ok('activated sets activated_at', !!activated?.activated_at);

  // 5) conversion link to a real tenant (created via the existing Create Tenant flow)
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code) VALUES ('00000000-0000-0000-0000-00000ad07e01','Glow LLC','Glow Nail Spa','glow','GLOW')`);
  const convd = await svc.markApplicationConverted(ctx, appId, '00000000-0000-0000-0000-00000ad07e01');
  ok('application marked converted with the real tenant id', convd?.status === 'converted' && !!convd?.converted_tenant_id);

  // 6) support access: reason + time limit mandatory; sessions end; appears active until ended
  ok('support access without a reason is rejected', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'no', minutes: 30 }), 'invalid'));
  ok('support access without a sane time limit is rejected', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Investigate checkout totals', minutes: 0 }), 'invalid'));
  // step-up: password is mandatory, wrong password fails closed
  ok('support access without the password is rejected (step-up)', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Investigate checkout totals', minutes: 30 }), 'invalid'));
  ok('support access with a WRONG password is rejected (step-up)', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Investigate checkout totals', minutes: 30, password: 'nope' }), 'invalid'));
  const sess = await svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Investigate checkout totals', minutes: 30, password: ADMIN_PW });
  ok('support session started with expiry', !!sess?.expires_at && !sess?.ended_at);
  const active = await svc.supportSessions(true);
  ok('session listed as active', active.some((s: any) => String(s.id) === String(sess.id)));
  await svc.endSupport(ctx, String(sess.id));
  const activeAfter = await svc.supportSessions(true);
  ok('ended session leaves the active list', !activeAfter.some((s: any) => String(s.id) === String(sess.id)));

  // step-up with an ENROLLED MFA factor: password alone is no longer enough; valid TOTP required; replay blocked
  const totpSecret = generateSecret();
  await k.insertInto('mfa_factors' as any).values({ user_id: ctx.userId, type: 'totp', secret_enc: encryptSecret(totpSecret), confirmed: true } as any).execute();
  ok('with MFA enrolled: password alone is rejected', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Follow-up on totals', minutes: 15, password: ADMIN_PW }), 'invalid'));
  ok('with MFA enrolled: wrong code is rejected', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Follow-up on totals', minutes: 15, password: ADMIN_PW, mfaCode: '000000' }), 'invalid'));
  const liveCode = totpCode(totpSecret, Date.now());
  const sess2 = await svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Follow-up on totals', minutes: 15, password: ADMIN_PW, mfaCode: liveCode });
  ok('password + live TOTP starts the session', !!sess2?.id && !sess2?.ended_at);
  ok('REPLAYED TOTP code is rejected (monotonic last_used_step)', await threw(() => svc.startSupport(ctx, { tenantId: convd.converted_tenant_id, reason: 'Replay attempt', minutes: 15, password: ADMIN_PW, mfaCode: liveCode }), 'invalid'));
  await svc.endSupport(ctx, String(sess2.id));
  const audStep: any[] = await k.selectFrom('audit_logs' as any).select(['action_type', 'metadata_json']).where('action_type', '=', 'super_admin_support_access_started' as any).execute();
  const stepUps = audStep.map((a) => { try { return (typeof a.metadata_json === 'string' ? JSON.parse(a.metadata_json) : a.metadata_json)?.stepUp; } catch { return undefined; } });
  ok('audit records WHICH step-up confirmed (password, then password+mfa)', stepUps.includes('password') && stepUps.includes('password+mfa'), JSON.stringify(stepUps));

  // 7) everything audited
  const audits: any[] = await k.selectFrom('audit_logs' as any).select(['action_type']).execute();
  const acts = new Set(audits.map((a) => a.action_type));
  const expected = ['super_admin_lead_created', 'super_admin_lead_converted', 'super_admin_application_created', 'super_admin_application_status', 'super_admin_hardware_created', 'super_admin_hardware_updated', 'super_admin_application_converted', 'super_admin_support_access_started', 'super_admin_support_access_ended'];
  ok(`audit_logs captured the full trail (${expected.length} action types)`, expected.every((a) => acts.has(a)), [...acts].join(','));

  // 8) state endpoint counts
  const state = await svc.state();
  ok('state: counts + recent lists shaped', typeof state.counts.newLeads === 'number' && Array.isArray(state.recentApplications) && Array.isArray(state.activeSupportSessions), JSON.stringify(state.counts));

  // 9) audit-log READER: filterable, paged, newest-first
  const allAudit = await svc.auditLogs({ page: 1, pageSize: 50 });
  ok('audit reader returns the trail (>=9 rows, newest first)', allAudit.total >= 9 && allAudit.rows.length >= 9 && new Date(allAudit.rows[0].created_at).getTime() >= new Date(allAudit.rows[allAudit.rows.length - 1].created_at).getTime(), `total=${allAudit.total}`);
  const filtered = await svc.auditLogs({ action: 'support_access', page: 1, pageSize: 50 });
  ok('audit reader filters by action substring (support_access -> 2 starts + 2 ends)', filtered.total === 4 && filtered.rows.every((r: any) => String(r.action_type).includes('support_access')), `total=${filtered.total}`);
  const byEntity = await svc.auditLogs({ entityType: 'hardware_package' });
  ok('audit reader filters by entity type', byEntity.total >= 2 && byEntity.rows.every((r: any) => r.entity_type === 'hardware_package'), `total=${byEntity.total}`);

  // 10) payment-gateways platform view: per-tenant row, masked MID, terminal count, bolt flag
  await db.exec(`INSERT INTO tenant_payment_config (tenant_id, processor, merchant_id, status, environment) VALUES ('00000000-0000-0000-0000-00000ad07e01','fiserv','496160873888','active','sandbox')`);
  await db.exec(`INSERT INTO pos_payment_terminals (id, tenant_id, branch_id, label, status, paired_at) VALUES ('term_900001','00000000-0000-0000-0000-00000ad07e01',NULL,'Desk','paired',now())`);
  const gws = await svc.paymentGateways();
  const gw = gws.find((g: any) => g.tenantId === '00000000-0000-0000-0000-00000ad07e01');
  ok('gateways view: configured tenant row with MASKED mid + terminal count', !!gw && gw.merchantIdMasked === '••••3888' && gw.gatewayStatus === 'active' && gw.pairedTerminals === 1 && gw.boltConfigured === false, JSON.stringify(gw));
  ok('gateways view never exposes a full merchant id', gws.every((g: any) => !JSON.stringify(g).includes('496160873888')));

  // 11) AI packages: latest-row-wins (canonical pattern), validated values, audited
  const TEN = '00000000-0000-0000-0000-00000ad07e01';
  ok('bogus AI package rejected', await threw(() => svc.setAiPackage(ctx, TEN, 'AI Mega'), 'invalid'));
  await svc.setAiPackage(ctx, TEN, 'AI Basic');
  await svc.setAiPackage(ctx, TEN, 'AI Pro');
  const aip = await svc.aiPackages();
  const mine = aip.find((a: any) => a.tenantId === TEN);
  ok('AI packages view shows the LATEST package (AI Pro after Basic→Pro history)', mine?.package === 'AI Pro', JSON.stringify(mine));

  // 12) usage limits: upsert, validated metric + range, surfaces per-metric rows
  ok('bogus metric rejected', await threw(() => svc.setUsageLimit(ctx, TEN, 'gpu_hours', 100), 'invalid'));
  ok('negative limit rejected', await threw(() => svc.setUsageLimit(ctx, TEN, 'ai_calls', -5), 'invalid'));
  await svc.setUsageLimit(ctx, TEN, 'ai_calls', 5000);
  await svc.setUsageLimit(ctx, TEN, 'ai_calls', 8000); // upsert overwrites
  await svc.setUsageLimit(ctx, TEN, 'sms', 2000);
  const ul = await svc.usageLimits();
  const m = ul.find((u: any) => u.tenantId === TEN);
  const aiCalls = m?.metrics?.find((x: any) => x.metric === 'ai_calls');
  ok('usage limits view: upserted ai_calls=8000 + sms=2000 for the tenant', aiCalls?.limitValue === 8000 && m?.metrics?.some((x: any) => x.metric === 'sms' && x.limitValue === 2000), JSON.stringify(m?.metrics));
  const aip2 = await svc.aiPackages();
  ok('AI packages view carries the ai_calls limit', aip2.find((a: any) => a.tenantId === TEN)?.aiCallsLimit === 8000);
  const aud2: any[] = await k.selectFrom('audit_logs' as any).select(['action_type']).execute();
  const acts2 = new Set(aud2.map((a) => a.action_type));
  ok('package + limit changes are audited', acts2.has('super_admin_ai_package_changed') && acts2.has('super_admin_usage_limit_changed'));

  // 11b) per-feature AI toggles (spec §13): tier gates everything; explicit rows refine within a tier; null = inherit
  ok('bogus feature key rejected', await threw(() => svc.setAiFeature(ctx, TEN, 'ai_timetravel', false), 'invalid'));
  const aiBefore = (await svc.aiPackages()).find((a: any) => a.tenantId === TEN);
  ok('AI Pro tenant defaults: all seven features effective TRUE with no overrides', Object.keys(aiBefore.effectiveFeatures).length === 7 && Object.values(aiBefore.effectiveFeatures).every(Boolean) && Object.keys(aiBefore.featureOverrides).length === 0, JSON.stringify(aiBefore.effectiveFeatures));
  await svc.setAiFeature(ctx, TEN, 'ai_booking', false);
  const aiOff = (await svc.aiPackages()).find((a: any) => a.tenantId === TEN);
  ok('explicit OFF override: ai_booking effective false, the other six stay true', aiOff.effectiveFeatures.ai_booking === false && aiOff.effectiveFeatures.ai_receptionist === true && aiOff.featureOverrides.ai_booking === false);
  // tenant-facing overlay: the POS settings read must carry the SAME effective map (Super Admin -> tenant flow)
  const settingsRepo = new KyselySettingsRepository(k as any);
  const raw = await settingsRepo.getRaw({ tenantId: TEN, branchId: null, userId: ctx.userId } as any);
  ok('tenant settings overlay: subscriptionPlan carries aiPackage=AI Pro + effective aiFeatures (ai_booking false)', (raw as any).subscriptionPlan.aiPackage === 'AI Pro' && (raw as any).subscriptionPlan.aiPackageIncluded === true && (raw as any).subscriptionPlan.aiFeatures.ai_booking === false && (raw as any).subscriptionPlan.aiFeatures.voice_assistant === true, JSON.stringify((raw as any).subscriptionPlan.aiFeatures));
  await svc.setAiFeature(ctx, TEN, 'ai_booking', null); // revert to inherit
  const aiBack = (await svc.aiPackages()).find((a: any) => a.tenantId === TEN);
  ok('null reverts to inherit: ai_booking effective true again, override row gone', aiBack.effectiveFeatures.ai_booking === true && !('ai_booking' in aiBack.featureOverrides));
  // tier gate: a None-tier tenant gets effective FALSE even with an explicit TRUE override
  await db.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('00000000-0000-0000-0000-00000ad07e02','No AI LLC','Plain Nails','plain','PLAIN','active')`);
  await svc.setAiFeature(ctx, '00000000-0000-0000-0000-00000ad07e02', 'ai_booking', true);
  const plain = (await svc.aiPackages()).find((a: any) => a.tenantId === '00000000-0000-0000-0000-00000ad07e02');
  ok('tier gates all AI: package None → every feature effective false despite an explicit true override', plain.package === 'None' && Object.values(plain.effectiveFeatures).every((v: any) => v === false) && plain.featureOverrides.ai_booking === true, JSON.stringify(plain.effectiveFeatures));
  const audF: any[] = await k.selectFrom('audit_logs' as any).select(['action_type']).where('action_type', '=', 'super_admin_ai_feature_toggled' as any).execute();
  ok('feature toggles are audited (3 toggle actions)', audF.length === 3, `count=${audF.length}`);

  // 13) users & roles: create super admin, directory, disable/enable, reset, roles map — all audited
  ok('bad email rejected', await threw(() => svc.createSuperAdmin(ctx, { email: 'not-an-email', fullName: 'X Y' }), 'invalid'));
  const sa = await svc.createSuperAdmin(ctx, { email: 'ops@aipowersalon.com', fullName: 'Ops Admin' });
  ok('super admin created with one-time temp password', !!sa.id && /^Tmp-/.test(sa.temporaryPassword));
  ok('duplicate email rejected', await threw(() => svc.createSuperAdmin(ctx, { email: 'OPS@aipowersalon.com', fullName: 'Dup' }), 'invalid'));
  const saRow: any = await k.selectFrom('users' as any).selectAll().where('id', '=', sa.id as any).executeTakeFirst();
  ok('created row: role SUPER_ADMIN, platform-scope, invited, scrypt hash only', saRow?.role === 'SUPER_ADMIN' && saRow?.tenant_id === null && saRow?.status === 'invited' && String(saRow?.password_hash).startsWith('scrypt$') && saRow?.password_hash !== sa.temporaryPassword);
  const dir = await svc.users({ role: 'SUPER_ADMIN' });
  ok('directory filters by role + shows MFA/last-login fields', dir.rows.some((u: any) => u.id === sa.id && u.mfaEnabled === false && u.tenantName === 'Platform'), `total=${dir.total}`);
  const found = await svc.users({ search: 'Ops Admin' });
  ok('directory search by name finds the user', found.rows.some((u: any) => u.id === sa.id));
  ok('self-disable is rejected', await threw(() => svc.disableUser({ ...ctx, userId: sa.id }, sa.id), 'invalid'));
  await svc.disableUser(ctx, sa.id);
  const afterDis: any = await k.selectFrom('users' as any).select(['status']).where('id', '=', sa.id as any).executeTakeFirst();
  ok('disable suspends the user', afterDis?.status === 'suspended');
  await svc.enableUser(ctx, sa.id);
  const reset = await svc.resetUserPassword(ctx, sa.id);
  const afterReset: any = await k.selectFrom('users' as any).select(['status', 'password_hash']).where('id', '=', sa.id as any).executeTakeFirst();
  ok('reset mints a NEW one-time temp (status back to invited, only hash stored)', /^Tmp-/.test(reset.temporaryPassword) && reset.temporaryPassword !== sa.temporaryPassword && afterReset?.status === 'invited' && String(afterReset?.password_hash).startsWith('scrypt$'));
  const roles = svc.roles();
  ok('roles map exposes SUPER_ADMIN + OWNER permission sets', Array.isArray((roles as any).SUPER_ADMIN) && (roles as any).SUPER_ADMIN.length > 0 && Array.isArray((roles as any).OWNER));
  const aud3: any[] = await k.selectFrom('audit_logs' as any).select(['action_type']).execute();
  const acts3 = new Set(aud3.map((a) => a.action_type));
  ok('user lifecycle fully audited (created/disabled/enabled/password_reset)', ['super_admin_user_created', 'super_admin_user_disabled', 'super_admin_user_enabled', 'super_admin_user_password_reset'].every((a) => acts3.has(a)));

  // 14) platform reports (spec §16): every number derives from seeded real rows; declined payments excluded
  const TEN2 = '00000000-0000-0000-0000-00000ad07e01';
  const B1 = '00000000-0000-0000-0000-00000ad0b001';
  const TK = '00000000-0000-0000-0000-00000ad0c001';
  await db.exec(`INSERT INTO branches (id, tenant_id, name, state) VALUES ('${B1}','${TEN2}','Main','NJ')`);
  await db.exec(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES
    ('${TEN2}','${B1}','${TK}','card', 12000, 'approved', now()),
    ('${TEN2}','${B1}','${TK}','card',  8000, 'approved', now() - interval '1 month'),
    ('${TEN2}','${B1}','${TK}','card', 99900, 'declined', now())`);
  await db.exec(`UPDATE tenant_usage_limits SET used_value = 137 WHERE tenant_id = '${TEN2}' AND metric = 'ai_calls'`);
  await db.exec(`INSERT INTO tenant_subscriptions (tenant_id, plan, status) VALUES ('${TEN2}','Professional','active')`);
  const rep = await svc.reports();
  ok('reports: platform volume sums APPROVED only (20000, declined 99900 excluded)', rep.totals.platformVolumeCents === 20000, JSON.stringify(rep.totals));
  ok('reports: monthly payment volume has 2 month buckets (12000 + 8000)', rep.monthlyPaymentVolume.length === 2 && rep.monthlyPaymentVolume.reduce((a: number, m: any) => a + m.amountCents, 0) === 20000, JSON.stringify(rep.monthlyPaymentVolume));
  ok('reports: monthly tenant growth is nonempty (tenant created this run)', rep.monthlyTenantGrowth.length >= 1 && rep.monthlyTenantGrowth.reduce((a: number, m: any) => a + m.count, 0) >= 1);
  ok('reports: tenants by state counts the NJ branch tenant', rep.tenantsByState.some((r: any) => r.state === 'NJ' && r.tenants === 1), JSON.stringify(rep.tenantsByState));
  ok('reports: lead funnel + application pipeline + hardware status reflect seeded flow', (rep.leadFunnel.converted_to_application || 0) >= 1 && (rep.applicationPipeline.converted || 0) >= 1 && Object.values(rep.hardwareByStatus).reduce((a: number, b: any) => a + Number(b), 0) >= 1, JSON.stringify({ lf: rep.leadFunnel, ap: rep.applicationPipeline, hw: rep.hardwareByStatus }));
  ok('reports: top tenants by volume leads with Glow Nail Spa @ 20000', rep.topTenantsByVolume[0]?.tenantName === 'Glow Nail Spa' && rep.topTenantsByVolume[0]?.amountCents === 20000, JSON.stringify(rep.topTenantsByVolume));
  ok('reports: AI calls used aggregates the bumped counter (137)', rep.totals.aiCallsUsed === 137);
  ok('reports: support sessions (30d) counts both step-up sessions', rep.totals.supportSessions30d === 2, `30d=${rep.totals.supportSessions30d}`);
  ok('reports: subscriptions by plan shows Professional=1', rep.subscriptionsByPlan.Professional === 1, JSON.stringify(rep.subscriptionsByPlan));

  // 15) PUBLIC website intake: unauthenticated leads/applications with honeypot + per-IP rate limit
  const leadsBefore = (await svc.leads({ page: 1, pageSize: 100 })).total;
  const pl = await svc.publicCreateLead({ kind: 'demo_request', name: 'Web Visitor', salonName: 'Pearl Nails', email: 'visitor@example.com', sourcePage: '/free-package' }, '203.0.113.10');
  ok('public lead lands in the queue (status new)', !!pl.ok && (await svc.leads({ status: 'new', page: 1, pageSize: 100 })).rows.some((l: any) => String(l.id) === String((pl as any).id)));
  ok('public newsletter without email rejected', await threw(() => svc.publicCreateLead({ kind: 'newsletter', name: 'NoEmail' }, '203.0.113.11'), 'invalid'));
  ok('public bogus kind rejected', await threw(() => svc.publicCreateLead({ kind: 'hack', email: 'a@b.co' }, '203.0.113.11'), 'invalid'));
  ok('public oversize message rejected (2001 chars)', await threw(() => svc.publicCreateLead({ kind: 'contact', email: 'a@b.co', message: 'x'.repeat(2001) }, '203.0.113.11'), 'invalid'));
  const midCount = (await svc.leads({ page: 1, pageSize: 100 })).total;
  const hp = await svc.publicCreateLead({ kind: 'contact', email: 'bot@spam.io', website: 'http://spam' }, '203.0.113.12');
  ok('honeypot trips: generic ok returned, NO row written', !!hp.ok && !(hp as any).id && (await svc.leads({ page: 1, pageSize: 100 })).total === midCount);
  for (let i = 0; i < 4; i++) await svc.publicCreateLead({ kind: 'contact', email: `rl${i}@example.com` }, '203.0.113.50'); // + the gate consumed by nothing else on this ip
  await svc.publicCreateLead({ kind: 'contact', email: 'rl4@example.com' }, '203.0.113.50');
  ok('per-IP rate limit: 6th submission inside a minute rejected', await threw(() => svc.publicCreateLead({ kind: 'contact', email: 'rl5@example.com' }, '203.0.113.50'), 'rate_limited'));
  const okOther = await svc.publicCreateLead({ kind: 'contact', email: 'other@example.com' }, '203.0.113.51');
  ok('rate limit is per-IP: a different IP still passes', !!okOther.ok && !!(okOther as any).id);
  const pa = await svc.publicCreateApplication({ salonName: 'Pearl Nails', ownerName: 'Mina Tran', email: 'mina@pearl.com', techniciansCount: 6, preferredImacColor: 'Pink', monthlyCardVolumeCents: 4_500_000 }, '203.0.113.60');
  const appsNew = await svc.applications({ status: 'new', page: 1, pageSize: 100 });
  ok('public application lands in the §7 queue (status new, fields carried)', !!pa.ok && appsNew.rows.some((a: any) => String(a.id) === String((pa as any).id) && a.preferred_imac_color === 'Pink' && Number(a.technicians_count) === 6));
  ok('public application without owner name rejected', await threw(() => svc.publicCreateApplication({ salonName: 'X Nails', email: 'x@y.co' }, '203.0.113.61'), 'invalid'));
  ok('lead totals grew only by the legit submissions', (await svc.leads({ page: 1, pageSize: 100 })).total === leadsBefore + 7, `before=${leadsBefore} after=${(await svc.leads({ page: 1, pageSize: 100 })).total}`);

  await k.destroy(); await server.stop(); await db.close();
  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} verify-super-admin-platform: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
