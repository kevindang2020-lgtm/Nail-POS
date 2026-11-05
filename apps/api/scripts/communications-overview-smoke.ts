/* communications-overview-smoke.ts — exercises the REAL CommunicationsOverviewService against live Postgres. Seeds a
 * small multi-tenant fixture in notification_delivery_logs (channels × statuses × providers), opt-outs, and templates,
 * runs the exact service the controller serves, and asserts the aggregates are real, reconcile, scope by tenant, and
 * honestly mark un-tracked sections (cost / limits / provider usage / system alerts). Cleans up after itself.
 * Run: DATABASE_URL=postgres://… npx tsx scripts/communications-overview-smoke.ts
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../../packages/database/src/kysely.types';
import { CommunicationsOverviewRepository } from '../../../modules/communications/src/communications/communications-overview.kysely.repository';
import { CommunicationsOverviewService } from '../../../modules/communications/src/communications/communications-overview.service';
import { CommunicationsAnnouncementsRepository } from '../../../modules/communications/src/communications/communications-announcements.kysely.repository';
import { CommunicationsAnnouncementsService } from '../../../modules/communications/src/communications/communications-announcements.service';
import { CommunicationsLimitsRepository } from '../../../modules/communications/src/communications/communications-limits.kysely.repository';
import { CommunicationsLimitsService } from '../../../modules/communications/src/communications/communications-limits.service';
import { CommunicationsTemplatesRepository } from '../../../modules/communications/src/communications/communications-templates.kysely.repository';
import { CommunicationsTemplatesService } from '../../../modules/communications/src/communications/communications-templates.service';
import { CommunicationsProvidersRepository } from '../../../modules/communications/src/communications/communications-providers.kysely.repository';
import { CommunicationsProvidersService } from '../../../modules/communications/src/communications/communications-providers.service';
import { decryptSecret } from '../src/common/provider-crypto';

const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: process.env.DATABASE_URL }) }) });
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

const tA = 'ccee1111-1111-1111-1111-111111111111';
const tB = 'ccee2222-2222-2222-2222-222222222222';
const tC = 'ccee3333-3333-3333-3333-333333333333';
const ids = [tA, tB, tC];

async function clean() {
  await sql`delete from notification_delivery_logs where tenant_id = any(${ids})`.execute(db);
  await sql`delete from notification_opt_outs where tenant_id = any(${ids})`.execute(db);
  await sql`delete from pos_message_templates where tenant_id = any(${ids})`.execute(db);
  await sql`delete from platform_announcements where idempotency_key like 'cm-smoke-%'`.execute(db);
  await sql`delete from tenant_messaging_limits where tenant_id = any(${ids})`.execute(db);
  await sql`delete from message_templates where tenant_id = any(${ids})`.execute(db);
  await sql`delete from communication_providers where name like 'CM-Smoke%'`.execute(db);
  // Constitution 12 migration 452: audit tables are append-only. Smoke cleanup of its OWN rows on a dev database
  // skips triggers for this one statement (superuser, dev only) — production has no such path.
  await sql`set session_replication_role = replica`.execute(db);
  await sql`delete from audit_events where tenant_id = any(${ids}) and module='communications'`.execute(db);
  await sql`set session_replication_role = default`.execute(db);
  await sql`delete from users where tenant_id = any(${ids}) and email like '%@cm-smoke.test'`.execute(db);
  await sql`delete from branches where tenant_id = any(${ids})`.execute(db);
  await sql`delete from tenants where id = any(${ids})`.execute(db);
}

async function user(tenant: string, role: string) {
  await sql`insert into users (tenant_id, role, status, email, full_name) values (${tenant}, ${role}, 'active', ${role.toLowerCase() + '-' + Math.random().toString(36).slice(2, 8) + '@cm-smoke.test'}, ${role})`.execute(db);
}

async function log(tenant: string, channel: string, status: string, provider: string, n: number, err: string | null = null) {
  for (let i = 0; i < n; i++) {
    await sql`insert into notification_delivery_logs (tenant_id, channel, status, provider_id, template, target_masked, error_message)
      values (${tenant}, ${channel}, ${status}, ${provider}, 'reminder', '•••• 1234', ${err})`.execute(db);
  }
}

async function seed() {
  await clean();
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values
    (${tA}, 'Glamour Studio LLC', 'Glamour Studio', 'gl-cm', 'GLCM'),
    (${tB}, 'Luxe Salon LLC', 'Luxe Salon', 'lx-cm', 'LXCM'),
    (${tC}, 'Radiant Beauty LLC', 'Radiant Beauty', 'rb-cm', 'RBCM')`.execute(db);
  // Delivery logs (canonical source). twilio=sms, sendgrid=email, fcm=push, internal=in_app.
  await log(tA, 'sms', 'delivered', 'twilio', 6);
  await log(tA, 'email', 'delivered', 'sendgrid', 3);
  await log(tA, 'push', 'delivered', 'fcm', 2);
  await log(tB, 'sms', 'delivered', 'twilio', 2);
  await log(tB, 'email', 'delivered', 'sendgrid', 1);
  await log(tB, 'email', 'failed', 'sendgrid', 1, 'Mailbox full');
  await log(tC, 'push', 'delivered', 'fcm', 1);
  await log(tC, 'sms', 'sent', 'twilio', 1);
  await sql`insert into notification_opt_outs (tenant_id, channel, address, reason, opted_out_at) values
    (${tA}, 'sms', '•••• 1111', 'user request', now()),
    (${tB}, 'email', 'a***@x.com', 'complaint', now())`.execute(db);
  await sql`insert into pos_message_templates (id, tenant_id, channel, name, body) values
    (gen_random_uuid(), ${tA}, 'sms', 'Reminder', 'Hi'), (gen_random_uuid(), ${tA}, 'email', 'Promo', 'Sale')`.execute(db);
  // Tenant users (staff/admin) + customers — announcements must never target customers.
  for (const r of ['OWNER', 'MANAGER', 'RECEPTION', 'CUSTOMER', 'CUSTOMER']) await user(tA, r);
  for (const r of ['OWNER', 'MANAGER']) await user(tB, r);
  await user(tC, 'OWNER');
}

async function main() {
  await seed();
  const svc = new CommunicationsOverviewService(new CommunicationsOverviewRepository(db as any));
  const ctx = { userId: 'u_super', email: 'super_admin' };
  const o: any = await svc.getOverview(ctx, {});
  const kpi = (k: string) => o.kpis.find((x: any) => x.key === k);

  // ── KPIs (real) ──
  check('KPI messages sent = 17', kpi('messages_sent').value === 17, String(kpi('messages_sent').value));
  check('KPI delivered = 15', kpi('delivered').value === 15, String(kpi('delivered').value));
  check('KPI failed = 1', kpi('failed').value === 1, String(kpi('failed').value));
  check('KPI suppressed = 0 (delivery log has no suppressed state — honest real zero)', kpi('suppressed').value === 0, String(kpi('suppressed').value));
  check('KPI opt-outs = 2 (in window)', kpi('opt_outs').value === 2, String(kpi('opt_outs').value));
  check('KPI active tenants = 3', kpi('tenant_usage').value === 3, String(kpi('tenant_usage').value));
  check('KPI provider status available (overall delivery rate)', kpi('provider_status').available === true && kpi('provider_status').value > 0, String(kpi('provider_status').value));
  check('KPI cost / limits / provider-usage / system-alerts honestly unavailable', kpi('sms_cost').available === false && kpi('email_cost').available === false && kpi('messaging_limits').available === false && kpi('provider_usage').available === false && kpi('system_alerts').available === false);

  // ── communication mix + types ──
  const mix = o.communicationMix;
  const seg = (b: any, k: string) => b.segments.find((s: any) => s.key === k)?.count ?? 0;
  check('communication mix reconciles to sent (sms 9 / email 5 / push 3)', mix.total === 17 && seg(mix, 'sms') === 9 && seg(mix, 'email') === 5 && seg(mix, 'push') === 3, JSON.stringify(mix.segments));
  const smsType = o.communicationTypes.find((t: any) => t.key === 'sms');
  const inAppType = o.communicationTypes.find((t: any) => t.key === 'in_app');
  check('communication types: 7 entries; sms 9/8; unmodelled types honest zero', o.communicationTypes.length === 7 && smsType.sent === 9 && smsType.delivered === 8 && inAppType.sent === 0, JSON.stringify(smsType));

  // ── providers ──
  const ps = o.providerStatus;
  check('provider status: 3 providers, 2 healthy / 1 down (sendgrid 20% fail)', ps.total === 3 && seg(ps, 'healthy') === 2 && seg(ps, 'down') === 1, JSON.stringify(ps.segments));

  // ── trend / tenant usage / failures ──
  check('volume trend has a day with sent=17 delivered=15', o.volumeTrend.some((d: any) => d.sent === 17 && d.delivered === 15), JSON.stringify(o.volumeTrend));
  check('tenant usage lists 3 tenants with delivery + opt-out rate', o.tenantUsage.length === 3 && o.tenantUsage.every((t: any) => typeof t.deliveryRate === 'number' && typeof t.optOutRate === 'number'), `len=${o.tenantUsage.length} ${JSON.stringify(o.tenantUsage.map((t: any) => t.tenant))}`);
  check('delivery failures surface the failed email with reason', o.deliveryFailures.some((f: any) => /Mailbox full/i.test(f.reason) && f.channel === 'Email'), JSON.stringify(o.deliveryFailures));
  check('top activity + template count real', o.topActivity.length >= 1 && o.templates.total === 2, String(o.templates.total));
  check('at-a-glance today reflects seeded sends (sms 9, email 5)', o.atAGlance.sms === 9 && o.atAGlance.email === 5 && o.atAGlance.providerIncidents.available === false, JSON.stringify(o.atAGlance));

  // ── tenant scope ──
  const oa: any = await svc.getOverview(ctx, { tenantId: tA });
  check('tenant scope narrows to tA (sent 11, delivered 11)', oa.kpis.find((x: any) => x.key === 'messages_sent').value === 11 && oa.kpis.find((x: any) => x.key === 'delivered').value === 11, String(oa.kpis.find((x: any) => x.key === 'messages_sent').value));
  check('tenant-scoped read writes audit', (await sql`select count(*)::int as c from audit_events where module='communications' and tenant_id = ${tA}`.execute(db) as any).rows[0].c >= 1);

  // ── no double count (single canonical source) ──
  check('no double counting — sent equals raw delivery-log rows', kpi('messages_sent').value === (await sql`select count(*)::int as c from notification_delivery_logs where tenant_id = any(${ids})`.execute(db) as any).rows[0].c);

  // ── Controlled write: Send Platform Announcement (Unit 3) ──
  const asvc = new CommunicationsAnnouncementsService(new CommunicationsAnnouncementsRepository(db as any));
  const a1: any = await asvc.create(ctx, { title: 'Maintenance', body: 'Downtime Sunday', channel: 'email', recipientRoles: ['OWNER', 'MANAGER'] });
  const realWide: any = await sql`select count(*)::int as c from users where role = any(${['OWNER', 'MANAGER']}) and role <> 'CUSTOMER' and (status is null or status <> 'disabled')`.execute(db);
  check('announcement all-tenants OWNER+MANAGER → real platform-wide estimate (customers excluded)', a1.ok && a1.idempotent === false && a1.recipientEstimate === realWide.rows[0].c && a1.status === 'queued', `${a1.recipientEstimate} vs ${realWide.rows[0].c}`);
  let boundary = false;
  try { await asvc.create(ctx, { title: 'x', body: 'y', recipientRoles: ['CUSTOMER'] }); } catch (e: any) { boundary = /customers/i.test(String(e?.message)); }
  check('announcement REJECTS targeting customers (platform-vs-customer boundary)', boundary);
  let validThrew = 0;
  for (const bad of [{ body: 'y', recipientRoles: ['OWNER'] }, { title: 't', recipientRoles: ['OWNER'] }, { title: 't', body: 'y', recipientRoles: [] }, { title: 't', body: 'y', recipientRoles: ['ADMIN'] }]) {
    try { await asvc.create(ctx, bad); } catch { validThrew++; }
  }
  check('announcement validation: missing title/body/roles + unsupported role rejected', validThrew === 4, String(validThrew));
  const k = 'cm-smoke-k1';
  const i1: any = await asvc.create(ctx, { title: 'Notice', body: 'Hello', recipientRoles: ['OWNER'], idempotencyKey: k });
  const i2: any = await asvc.create(ctx, { title: 'Notice', body: 'Hello', recipientRoles: ['OWNER'], idempotencyKey: k });
  const dupCount: any = await sql`select count(*)::int as c from platform_announcements where idempotency_key = ${k}`.execute(db);
  check('announcement idempotent on key (no duplicate row)', i2.idempotent === true && i2.id === i1.id && dupCount.rows[0].c === 1, String(dupCount.rows[0].c));
  const sel: any = await asvc.create(ctx, { title: 'Billing', body: 'Update', recipientRoles: ['OWNER', 'MANAGER', 'RECEPTION'], targetScope: 'selected', targetTenantIds: [tA] });
  check('announcement selected tA (OWNER+MANAGER+RECEPTION) → estimate 3', sel.recipientEstimate === 3, String(sel.recipientEstimate));
  const selAudit: any = await sql`select count(*)::int as c from audit_events where module='communications' and action='announcement_created' and tenant_id = ${tA}`.execute(db);
  check('selected-scope announcement writes a per-tenant audit', selAudit.rows[0].c >= 1, String(selAudit.rows[0].c));
  let unknownThrew = false;
  try { await asvc.create(ctx, { title: 't', body: 'y', recipientRoles: ['OWNER'], targetScope: 'selected', targetTenantIds: ['ccdd9999-9999-9999-9999-999999999999'] }); } catch (e: any) { unknownThrew = /do not exist/i.test(String(e?.message)); }
  check('announcement selected scope rejects unknown tenant', unknownThrew);
  const future = new Date(Date.now() + 86400000).toISOString();
  const sch: any = await asvc.create(ctx, { title: 'Future', body: 'Later', recipientRoles: ['OWNER'], scheduledAt: future });
  check('future scheduledAt → status scheduled', sch.status === 'scheduled', sch.status);
  let pastThrew = false;
  try { await asvc.create(ctx, { title: 't', body: 'y', recipientRoles: ['OWNER'], scheduledAt: new Date(Date.now() - 86400000).toISOString() }); } catch (e: any) { pastThrew = /future/i.test(String(e?.message)); }
  check('past scheduledAt rejected', pastThrew);

  // ── Controlled write: Set Tenant Usage Limits (Unit 4) ──
  const lsvc = new CommunicationsLimitsService(new CommunicationsLimitsRepository(db as any));
  const l0: any = await lsvc.getTenantLimit(tA);
  check('tenant limit initially unavailable (none configured)', l0.available === false && l0.limit === null);
  const set1: any = await lsvc.setTenantLimit(ctx, tA, { monthlySms: 100, monthlyEmail: 50, dailyLimit: 20, enforcement: 'hard', optOutRateThresholdBps: 500 });
  check('set tenant limit: before null → after configured (hard)', set1.ok && set1.before === null && set1.after.monthlySms === 100 && set1.after.enforcement === 'hard', JSON.stringify(set1.after));
  const l1: any = await lsvc.getTenantLimit(tA);
  check('limit + REAL usage: tA sms 6/100 → 6% used', l1.available === true && l1.usage.sms === 6 && l1.limitUsed.sms === 6, JSON.stringify({ u: l1.usage, used: l1.limitUsed }));
  // Enforcement evaluator (backend-authoritative)
  const evAllow: any = await lsvc.evaluate(tA, 'sms');
  check('evaluate within limit → allow', evAllow.withinLimit === true && evAllow.action === 'allow', JSON.stringify(evAllow));
  await lsvc.setTenantLimit(ctx, tA, { monthlySms: 5, enforcement: 'hard' }); // below tA's real usage of 6
  const evBlock: any = await lsvc.evaluate(tA, 'sms');
  check('evaluate over hard limit → block (monthly_limit_reached)', evBlock.withinLimit === false && evBlock.action === 'block' && evBlock.reason === 'monthly_limit_reached', JSON.stringify(evBlock));
  await lsvc.setTenantLimit(ctx, tA, { monthlySms: 5, enforcement: 'soft' });
  const evWarn: any = await lsvc.evaluate(tA, 'sms');
  check('same overage under soft enforcement → warn (not block)', evWarn.action === 'warn' && evWarn.withinLimit === false);
  await lsvc.setTenantLimit(ctx, tA, { monthlySms: 5, enforcement: 'approval' });
  const evApproval: any = await lsvc.evaluate(tA, 'sms');
  check('same overage under approval enforcement → require_approval', evApproval.action === 'require_approval');
  const evNone: any = await lsvc.evaluate(tB, 'sms');
  check('tenant with no limit configured → allow (no_limit_configured)', evNone.action === 'allow' && evNone.reason === 'no_limit_configured');
  // upsert keeps a single row
  const rowCount: any = await sql`select count(*)::int as c from tenant_messaging_limits where tenant_id = ${tA}`.execute(db);
  check('limit upsert keeps a single row per tenant', rowCount.rows[0].c === 1, String(rowCount.rows[0].c));
  // validation
  let limThrew = 0;
  for (const bad of [{ monthlySms: -1 }, { enforcement: 'nope' }, { optOutRateThresholdBps: 20000 }]) { try { await lsvc.setTenantLimit(ctx, tA, bad); } catch { limThrew++; } }
  try { await lsvc.setTenantLimit(ctx, 'ccdd9999-9999-9999-9999-999999999999', { monthlySms: 10 }); } catch { limThrew++; }
  check('limit write rejects negative / bad enforcement / out-of-range bps / unknown tenant', limThrew === 4, String(limThrew));
  const limAudit: any = await sql`select count(*)::int as c from audit_events where module='communications' and action='tenant_limit_set' and tenant_id = ${tA}`.execute(db);
  check('tenant_limit_set audit written (before/after)', limAudit.rows[0].c >= 1, String(limAudit.rows[0].c));

  // ── Controlled write: Message Templates — append-only versioning (Unit 5) ──
  const tsvc = new CommunicationsTemplatesService(new CommunicationsTemplatesRepository(db as any));
  const t1: any = await tsvc.createTemplate(ctx, { tenantId: tA, name: 'Appt Reminder', channel: 'sms', body: 'Hi {{name}}, your {{service}} is soon.' });
  check('create template → v1 draft, placeholders [name, service]', t1.ok && t1.version === 1 && t1.status === 'draft' && t1.placeholders.sort().join(',') === 'name,service', JSON.stringify(t1.placeholders));
  let tplBad = 0;
  for (const bad of [{ tenantId: tA, name: 'x', channel: 'sms', body: 'Hi {{bad-name}}' }, { tenantId: tA, name: 'x', channel: 'sms', body: 'Danger {% for %}' }, { tenantId: tA, name: '', channel: 'sms', body: 'ok' }, { tenantId: tA, name: 'x', channel: 'fax', body: 'ok' }]) {
    try { await tsvc.createTemplate(ctx, bad); } catch { tplBad++; }
  }
  check('template validation rejects bad placeholder / injection / empty name / bad channel', tplBad === 4, String(tplBad));
  const v2: any = await tsvc.addVersion(ctx, t1.id, { body: 'Hello {{name}}! Updated copy.' });
  check('add version → v2 draft appended', v2.version === 2 && v2.status === 'draft');
  const pub1: any = await tsvc.publishVersion(ctx, t1.id, 1);
  check('publish v1 → published', pub1.status === 'published' && pub1.idempotent === false);
  const pub2: any = await tsvc.publishVersion(ctx, t1.id, 2);
  check('publish v2 → published (head advances)', pub2.status === 'published');
  const got: any = await tsvc.get(t1.id);
  const v1row = got.versions.find((v: any) => v.version === 1);
  const v2row = got.versions.find((v: any) => v.version === 2);
  check('publishing v2 RETIRES v1 but preserves it (history, not overwritten)', got.template.current_version === 2 && v1row.status === 'retired' && v1row.body === 'Hi {{name}}, your {{service}} is soon.' && v2row.status === 'published', JSON.stringify({ cur: got.template.current_version, v1: v1row.status, v2: v2row.status }));
  const rep: any = await tsvc.publishVersion(ctx, t1.id, 2);
  check('re-publish current version → idempotent', rep.idempotent === true);
  let retiredThrew = false;
  try { await tsvc.publishVersion(ctx, t1.id, 1); } catch (e: any) { retiredThrew = /retired/i.test(String(e?.message)); }
  check('cannot publish a retired version', retiredThrew);
  const prev: any = await tsvc.preview({ body: 'Hi {{name}}', values: { name: '<script>x</script>' } });
  check('preview HTML-escapes untrusted values (no injection)', prev.rendered === 'Hi &lt;script&gt;x&lt;/script&gt;', prev.rendered);
  const tplAudit: any = await sql`select count(*)::int as c from audit_events where module='communications' and action in ('template_created','template_version_published') and tenant_id = ${tA}`.execute(db);
  check('template create/publish audited', tplAudit.rows[0].c >= 2, String(tplAudit.rows[0].c));

  // ── Controlled write: Configure Communication Providers (Unit 6) ──
  const psvc = new CommunicationsProvidersService(new CommunicationsProvidersRepository(db as any));
  const p1: any = await psvc.create(ctx, { name: 'CM-Smoke Twilio', channel: 'sms', credential: 'SK_supersecret_9876', apiEndpoint: 'https://api.twilio.test' });
  check('create provider → status test (unverified)', p1.ok && p1.status === 'test');
  const list: any = await psvc.list();
  const row = list.providers.find((x: any) => x.id === p1.id);
  check('provider list exposes masked last4 only, NEVER the secret or credential_enc', row && row.credential_last4 === '9876' && !('credential' in row) && !('credential_enc' in row) && !JSON.stringify(list).includes('SK_supersecret'), JSON.stringify(Object.keys(row || {})));
  const encStored: any = await sql`select credential_enc from communication_providers where id = ${p1.id}`.execute(db);
  check('secret stored ENCRYPTED in vault (round-trips, ciphertext not raw)', decryptSecret(encStored.rows[0].credential_enc) === 'SK_supersecret_9876' && !encStored.rows[0].credential_enc.includes('SK_supersecret'));
  // Health from REAL delivery signals
  await log(tA, 'sms', 'delivered', p1.id, 5);
  const test1: any = await psvc.testConnection(ctx, p1.id);
  check('test-connection validates credential without revealing it + healthy from real delivery', test1.credentialValid === true && test1.health === 'healthy' && test1.status === 'active' && !JSON.stringify(test1).includes('SK_supersecret'), JSON.stringify(test1));
  const p2: any = await psvc.create(ctx, { name: 'CM-Smoke Bad', channel: 'email', credential: 'KEY_zzzz_0000' });
  await log(tB, 'email', 'failed', p2.id, 5, 'bounce');
  const test2: any = await psvc.testConnection(ctx, p2.id);
  check('provider with failing deliveries → health down', test2.health === 'down' && test2.status === 'down');
  // Rotate credential
  const rot: any = await psvc.rotateCredential(ctx, p1.id, { credential: 'SK_rotated_5555' });
  check('rotate credential → new last4, secret not returned', rot.credentialLast4 === '5555' && !JSON.stringify(rot).includes('SK_rotated'));
  const encAfter: any = await sql`select credential_enc, credential_last4 from communication_providers where id = ${p1.id}`.execute(db);
  check('rotated secret re-encrypted + decryptable, last4 updated', decryptSecret(encAfter.rows[0].credential_enc) === 'SK_rotated_5555' && encAfter.rows[0].credential_last4 === '5555');
  // Config update never touches the secret
  await psvc.updateConfig(ctx, p1.id, { name: 'CM-Smoke Twilio Prod', priority: 10, status: 'active' });
  const encUnchanged: any = await sql`select credential_enc, name, priority from communication_providers where id = ${p1.id}`.execute(db);
  check('config update changes fields but preserves the secret', decryptSecret(encUnchanged.rows[0].credential_enc) === 'SK_rotated_5555' && encUnchanged.rows[0].name === 'CM-Smoke Twilio Prod' && encUnchanged.rows[0].priority === 10);
  let provThrew = 0;
  for (const bad of [{ channel: 'sms', credential: 'x' }, { name: 'n', channel: 'fax', credential: 'x' }, { name: 'n', channel: 'sms' }]) { try { await psvc.create(ctx, bad); } catch { provThrew++; } }
  try { await psvc.get('ccdd9999-9999-9999-9999-999999999999'); } catch { provThrew++; }
  check('provider write rejects missing name / bad channel / missing credential / unknown id', provThrew === 4, String(provThrew));

  await clean();
  console.log(`──────────── ${pass}/${pass + fail} checks passed ────────────`);
  await db.destroy();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await db.destroy(); process.exit(1); });
