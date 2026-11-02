// cc-extra.mjs — Marketing → Campaign Center in the catalog harness (Campaign Center Complete Build Guide, Oct 30 2026): the REAL
// CampaignCenterController / CampaignCenter over the seeded TEST database, plus the owner's real case — "spring into glow",
// 20% off, SMS, typed audience 50, Completed, 0 sent — seeded EXACTLY as the old form left it (no send records, no plan).
// Controls (GET /__cc?…):
//   state=1        DB truth: campaigns by status, send-ledger rows, notifications (by status), plans, health runs
//   execute=<id>   ONE run of the REAL send executor (AiMarketingSendService) over the approved snapshot, as the worker would,
//                  with a TEST sender that only writes a 'simulated' notifications row (no provider, nothing leaves the machine)
//   deliver=<id>   a TEST provider callback: the first simulated message of that campaign → delivered
//   many=N         N extra draft campaigns spread over past days (paging / newest-first fixtures; never sendable)
//   revoke=<name>  that customer withdraws SMS consent (consent changed after scheduling)
// Tooling only; nothing is sent or charged.
import { CampaignCenter } from '../../modules/communications/src/campaigns/campaign-center.ts';
import { CampaignCenterController } from '../../modules/communications/src/campaigns/campaign-center.controller.ts';
import { AiMarketingSendService } from '../../modules/ai/src/ai-marketing/ai-marketing-send.service.ts';
import { snapshotRecipients } from '../../modules/ai/src/ai-marketing/ai-marketing-send.adapters.ts';

const P = 'cc739000-0000-4000-8000-0000000';
const id = (n) => P + String(n).padStart(5, '0');
export const SPRING = id(1);
const PEOPLE = [['Ava', 'Glow', true], ['Ben', 'Shine', true], ['Cara', 'Polish', true], ['Dee', 'Lacquer', true], ['Eve', 'NoConsent', false], ['Fay', 'NoPhone', true]];

export function ccExtra(db, pg) {
  const center = new CampaignCenter(db);
  const q = (s, p = []) => pg.query(s, p);
  let n = 0;
  return {
    async seed(T, B) {
      await q(`insert into campaigns (id, tenant_id, branch_id, name, offer, channel, audience_label, audience_size, status, created_at, started_at, updated_at)
        values ($1,$2,null,'spring into glow','20% off','sms','Lapsed clients',50,'completed', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days') on conflict (id) do nothing`, [SPRING, T]);
      const draft = id(90);
      await q(`insert into segment_audience_drafts (id, tenant_id, channel, ruleset_version, segment, selection_mode, selected_count, eligible_count, excluded_count, idempotency_key, expires_at)
        values ($1,$2,'sms','segments-v1','returning','selected',6,4,2,'cc-e2e-draft', now() + interval '7 days') on conflict (id) do nothing`, [draft, T]);
      let i = 0;
      for (const [f, l, consent] of PEOPLE) {
        const cid = id(100 + (++i));
        const phone = l === 'NoPhone' ? null : '+1215555' + String(4100 + i);
        await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, marketing_sms_opt_in) values ($1,$2,$3,$4,$5,$6,$7,'active',$8) on conflict (id) do nothing`, [cid, T, B, f, l, `${f} ${l}`, phone, consent]);
        const el = !consent ? 'no_consent' : !phone ? 'no_phone' : 'eligible';
        await q(`insert into segment_audience_members (draft_id, tenant_id, customer_id, eligibility, destination_masked) values ($1,$2,$3,$4,$5) on conflict do nothing`, [draft, T, cid, el, phone ? '••• ' + phone.slice(-4) : null]);
      }
      return { campaignCenterSeeded: 1 };
    },
    routes: (routesOf) => [
      ...routesOf('modules/communications/src/campaigns/campaign-center.controller.ts', '/pos/campaign-center', new CampaignCenterController(center)),
    ],
    async control(sp, T) {
      if (sp.get('state')) {
        const one = async (s, p = [T]) => (await q(s, p)).rows;
        return {
          campaigns: await one(`select status, count(*)::int n from campaigns where tenant_id = $1 group by 1 order by 1`),
          spring: (await one(`select status, audience_size, sent_count, audience_source from campaigns where id = $1`, [SPRING]))[0],
          ledger: Number((await one(`select count(*)::int n from ai_marketing_campaign_sends where tenant_id = $1`))[0].n),
          notifications: await one(`select status, count(*)::int n from notifications where tenant_id = $1 and channel = 'sms' group by 1 order by 1`),
          // every notifications row (the harness seeds Communications messages too) and the ones a campaign send created
          notifTotal: Number((await one(`select count(*)::int n from notifications where tenant_id = $1`))[0].n),
          campaignMessages: Number((await one(`select count(*)::int n from notifications n where n.tenant_id = $1 and exists (select 1 from ai_marketing_campaign_sends s where s.tenant_id = n.tenant_id and s.provider_id = n.provider_id)`))[0].n),
          realProviderSends: Number((await one(`select count(*)::int n from notifications n where n.tenant_id = $1 and n.provider_id not like 'SMtest%' and exists (select 1 from ai_marketing_campaign_sends s where s.tenant_id = n.tenant_id and s.provider_id = n.provider_id)`))[0].n),
          plans: Number((await one(`select count(*)::int n from ai_marketing_campaign_plans where tenant_id = $1`))[0].n),
          healthRuns: Number((await one(`select count(*)::int n from campaign_health_runs where tenant_id = $1`))[0].n),
        };
      }
      if (sp.get('revoke')) { await q(`update customers set marketing_sms_opt_in = false where tenant_id = $1 and full_name = $2`, [T, sp.get('revoke')]); return { revoked: sp.get('revoke') }; }
      if (sp.get('many')) {
        const k = Math.min(60, Number(sp.get('many')) || 0);
        for (let i = 0; i < k; i++) await q(`insert into campaigns (tenant_id, name, channel, status, created_at) values ($1,$2,'email','draft', now() - make_interval(days => $3))`, [T, `Fixture campaign ${String(++n).padStart(2, '0')}`, 5 + i]);
        return { added: k };
      }
      if (sp.get('deliver')) {
        const r = await q(`update notifications set status = 'delivered', delivered_at = now() where id = (select n.id from notifications n join ai_marketing_campaign_sends s on s.provider_id = n.provider_id and s.tenant_id = n.tenant_id
            where s.campaign_id = $1 and n.status = 'simulated' order by n.created_at limit 1) returning id`, [sp.get('deliver')]);
        return { delivered: r.rows.length };
      }
      if (sp.get('execute')) {
        const cid = sp.get('execute');
        const plan = (await q(`select message_version, body, audience_definition from ai_marketing_campaign_plans where tenant_id = $1 and campaign_id = $2`, [T, cid])).rows[0];
        if (!plan) return { error: 'no plan — the worker would skip this campaign' };
        const sent = [];
        const lifecycle = {
          detail: async (_c, x) => { const r = (await q(`select id, status, channel from campaigns where tenant_id = $1 and id = $2`, [T, x])).rows[0]; return { ...r, id: String(r.id) }; },
          transition: async (_c, x, to) => { await q(`update campaigns set status = $3, started_at = case when $3 = 'in_progress' then coalesce(started_at, now()) else started_at end, completed_at = case when $3 = 'completed' then coalesce(completed_at, now()) else completed_at end where tenant_id = $1 and id = $2`, [T, x, to]); return { id: x, status: to }; },
        };
        const parse = (k) => k.split('|');
        const ledger = {
          claim: async (_k, p) => {
            const ins = (await q(`insert into ai_marketing_campaign_sends (tenant_id, branch_id, campaign_id, customer_id, channel, message_version, status) values ($1,$2,$3,$4,$5,$6,'queued') on conflict (tenant_id, campaign_id, customer_id, channel, message_version) do nothing returning id`, [p.tenantId, p.branchId, p.campaignId, p.customerId, p.channel, p.messageVersion])).rows[0];
            if (ins) return { created: true, status: 'queued' };
            const ex = (await q(`select status from ai_marketing_campaign_sends where tenant_id = $1 and campaign_id = $2 and customer_id = $3 and channel = $4 and message_version = $5`, [p.tenantId, p.campaignId, p.customerId, p.channel, p.messageVersion])).rows[0];
            return { created: false, status: String(ex?.status ?? 'queued') };
          },
          markSent: async (k, pid) => { const [t, c, cu, ch, v] = parse(k); await q(`update ai_marketing_campaign_sends set status = 'sent', provider_id = $6, updated_at = now() where tenant_id = $1 and campaign_id = $2 and customer_id = $3 and channel = $4 and message_version = $5 and status = 'queued'`, [t, c, cu, ch, Number(v), pid]); },
          markSkipped: async (k, reason) => { const [t, c, cu, ch, v] = parse(k); await q(`update ai_marketing_campaign_sends set status = 'skipped', skip_reason = $6, updated_at = now() where tenant_id = $1 and campaign_id = $2 and customer_id = $3 and channel = $4 and message_version = $5 and status = 'queued'`, [t, c, cu, ch, Number(v), reason]); },
          markFailed: async (k, reason) => { const [t, c, cu, ch, v] = parse(k); await q(`update ai_marketing_campaign_sends set status = 'failed', skip_reason = $6, updated_at = now() where tenant_id = $1 and campaign_id = $2 and customer_id = $3 and channel = $4 and message_version = $5 and status = 'queued'`, [t, c, cu, ch, Number(v), reason]); },
        };
        const def = typeof plan.audience_definition === 'string' ? JSON.parse(plan.audience_definition) : plan.audience_definition;
        const recipients = { enumerate: async (ctx, c) => snapshotRecipients(db, ctx.tenantId, c.id, def.snapshotVersion, c.channel) };
        const suppression = { isOptedOut: async (t, ch, addr) => (await q(`select 1 from notification_opt_outs where tenant_id = $1 and channel = $2 and address = $3`, [t, ch, addr])).rows.length > 0 };
        const dispatcher = { send: async (_ctx, m) => {   // the TEST sender: a 'simulated' log row, never a provider
          const pid = 'SMtest' + Date.now().toString(36) + (++n);
          await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, provider_id) values ($1,$2,$3,$4,$5,'simulated',$6)`, [T, m.channel, m.to, m.body, m.customerId, pid]);
          sent.push(m.to); return { sent: true, status: 'simulated', providerId: pid };
        } };
        const exe = new AiMarketingSendService(lifecycle, recipients, ledger, { evaluate: async () => ({ action: 'allow' }) }, suppression, { isActive: async () => false }, dispatcher);
        const s = await exe.executeCampaign({ tenantId: T, branchId: null, userId: 'system', role: 'SYSTEM' }, { campaignId: cid, messageVersion: Number(plan.message_version), body: String(plan.body) });
        return { summary: s, testSends: sent.length };
      }
      return { ok: true };
    },
  };
}
