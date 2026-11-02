// mt-extra.mjs — Communications → Message Templates in the catalog harness (Message Templates & Automation Center guide, Oct 30
// 2026): the REAL MessageTemplatesController → MessageTemplatesCenter → SQL on the seeded TEST database, and the REAL
// NotificationsService whose salon sender talks to the FAKE Twilio (comms-extra fakeTwilio — nothing leaves the machine; the
// platform's shared sender throws if anything ever reaches it). Tooling only — never shipped. Seeds NOTHING: the guide's first
// check is that the empty "No templates yet" state is the salon's real zero.
// Controls (GET /__mt?…): state=1 → DB truth (templates / versions / usage / tests / bindings / notification rows / audit rows) ·
// bump=<id> → "another manager" saves the template (record_version moves) · bulk=<n> → n more templates · reset=1 → this
// section's rows removed (test database only).
import { MessageTemplatesController } from '../../modules/communications/src/templates/message-templates.controller.ts';
import { MessageTemplatesCenter } from '../../modules/communications/src/templates/message-templates.ts';
import { NotificationsService } from '../../modules/communications/src/notifications/notifications.service.ts';
import { KyselyNotificationsRepository } from '../../modules/communications/src/notifications/notifications.kysely.repository.ts';
import { KyselyOptOutRepository } from '../../modules/communications/src/notifications/notifications.optout.kysely.repository.ts';
import { KyselyTenantSmsSenderResolver } from '../../modules/communications/src/notifications/notifications.tenant-sender.ts';
import { testProviderSecrets } from '../../packages/testing/src/provider-secrets.ts';
import { fakeTwilio } from './comms-extra.mjs';

export function mtExtra(db, pg, { OWNER_USER }) {
  const platformNever = { send: async () => { throw new Error('harness: the platform sender is never used for a template test'); } };
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db), platformNever, { send: async () => ({ id: 'EM-harness' }) }, undefined,
    new KyselyOptOutRepository(db), undefined, new KyselyTenantSmsSenderResolver(db, testProviderSecrets, fakeTwilio));
  const center = new MessageTemplatesCenter(db, notifications);
  const q = (s, p = []) => pg.query(s, p);
  const owner = (T, B) => ({ tenantId: T, branchId: B, userId: OWNER_USER, role: 'MANAGER', permissions: ['pos.communications.view', 'pos.communications.manage', 'pos.communications.send'] });
  return {
    routes: (routesOf) => routesOf('modules/communications/src/templates/message-templates.controller.ts', '/pos/message-templates', new MessageTemplatesController(center)),
    async control(sp, T, B) {
      if (sp.get('state')) {
        return (await q(`select
            (select count(*)::int from pos_message_templates where tenant_id = $1) as templates,
            (select count(*)::int from pos_message_templates where tenant_id = $1 and status = 'active') as active,
            (select count(*)::int from pos_message_template_versions where tenant_id = $1) as versions,
            (select count(*)::int from pos_message_template_usage where tenant_id = $1) as usage,
            (select count(*)::int from pos_message_template_usage where tenant_id = $1 and workflow = 'sms_inbox') as inbox_usage,
            (select count(*)::int from pos_message_template_tests where tenant_id = $1) as tests,
            (select count(*)::int from pos_message_template_bindings where tenant_id = $1 and active) as bindings,
            (select count(*)::int from notifications where tenant_id = $1) as notifications,
            (select count(*)::int from audit_events where tenant_id = $1 and action like 'message_template.%') as audits`, [T])).rows[0];
      }
      if (sp.get('bump')) {
        const id = sp.get('bump'); const d = await center.detail(owner(T, null), id);
        const r = await center.update(owner(T, null), id, { recordVersion: d.template.recordVersion, description: 'Saved by another manager ' + new Date().toISOString() });
        return { recordVersion: r.template.recordVersion };
      }
      if (sp.get('bulk')) {
        const n = Math.min(60, Number(sp.get('bulk')) || 0);
        for (let i = 1; i <= n; i++) await center.create(owner(T, null), { name: `Bulk ${String(i).padStart(2, '0')}`, channel: i % 4 === 0 ? 'email' : 'sms', category: 'general', subject: i % 4 === 0 ? 'Hello from the salon' : null, body: `Note ${i} from {salon_name}`, activate: i % 5 !== 0 });
        return { created: n };
      }
      if (sp.get('reset')) {
        for (const t of ['pos_message_template_usage', 'pos_message_template_tests', 'pos_message_template_bindings', 'pos_message_template_versions', 'pos_message_templates']) await q(`delete from ${t} where tenant_id = $1`, [T]);
        return { reset: true };
      }
      return { ok: true };
    },
  };
}
