import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

// HelpCenterScreen.tsx — S23 Super Admin › Help Center. A Help Center is curated content, not a data-aggregation
// screen, so there are no fabricated metrics here. What IS real: System Status is wired to the live system-health
// probe (GET /super-admin/system-health — DB status/latency, uptime, environment), every documentation card
// navigates to a real admin screen, and the search filters the help topics client-side. A searchable knowledge-base
// CMS and a support-ticketing system aren't built — shown as honest gaps (the in-app links point to real areas; the
// external help center is the marketing site).

type Health = { ok?: boolean; database?: { ok: boolean; latencyMs?: number } | null; process?: { uptimeSeconds: number; env: string } | null } | null;
const uptime = (s?: number) => { if (!s) return '—'; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

type Topic = { q: string; a: string; to?: string };
const TOPICS: { section: string; items: Topic[] }[] = [
  {
    section: 'Getting started',
    items: [
      { q: 'How do I add a new salon (tenant)?', a: 'Open Tenants / Salons to review applications and provision new salons. Each tenant gets its own branches, staff, services and payment configuration.', to: '/tenants' },
      { q: 'How do I manage branches for a salon?', a: 'Branches shows every location across tenants with its status and activity. Multi-location owners are scoped via branch access.', to: '/branches' },
      { q: 'How do users and permissions work?', a: 'Users & Roles lists every account with its role. Roles map to permission sets; the platform is RBAC-gated and every privileged action is audited.', to: '/users-roles' },
    ],
  },
  {
    section: 'Payments & billing',
    items: [
      { q: 'Which payment processors are supported?', a: 'Fiserv (CardPointe / Bolt) and Clover only. Connect and monitor processor status per tenant under Integrations; raw credentials are never displayed.', to: '/integrations' },
      { q: 'Where do I manage plans and subscriptions?', a: 'Billing & Subscription shows each tenant’s plan, status and renewal. Change a plan or status inline; MRR populates once plan pricing is configured.', to: '/subscriptions' },
      { q: 'How do I review transactions?', a: 'Payments & Transactions aggregates card and cash activity across all tenants with refunds and processor breakdowns.', to: '/payments-transactions' },
    ],
  },
  {
    section: 'Operations & devices',
    items: [
      { q: 'How do I see all hardware in the field?', a: 'Devices Management unifies payment terminals, customer displays, check-in kiosks and leased hardware across every tenant, with online/offline status.', to: '/devices-management' },
      { q: 'Where are reminders and follow-ups configured?', a: 'Smart Reminders covers reminder delivery and outcomes; Automation Rules covers reminder and end-of-day follow-up automations per tenant.', to: '/automation-rules' },
      { q: 'How do I reach customers across channels?', a: 'Communications is the cross-tenant inbox (SMS, email, call); Campaigns and Promotions handle outbound marketing.', to: '/communications' },
    ],
  },
  {
    section: 'Security & compliance',
    items: [
      { q: 'How do I check the platform’s security posture?', a: 'Security & Compliance tracks MFA adoption, login security, privileged support-access sessions and compliance opt-outs.', to: '/security-compliance' },
      { q: 'Where is the audit trail?', a: 'Audit Logs is the append-only, cross-tenant record of every important action, filterable by action, module, tenant and date.', to: '/audit-logs' },
      { q: 'How do I secure my own account?', a: 'General Settings lets you enrol TOTP multi-factor authentication (MFA) and change your password; both are required at sensitive steps.', to: '/settings' },
    ],
  },
];

export function HelpCenterScreen() {
  const nav = useNavigate();
  const [health, setHealth] = useState<Health>(null);
  const [q, setQ] = useState('');

  useEffect(() => { (superAdminApi.systemHealth() as Promise<Health>).then(setHealth).catch(() => setHealth(null)); }, []);

  const sections = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return TOPICS;
    return TOPICS.map((s) => ({ ...s, items: s.items.filter((i) => i.q.toLowerCase().includes(term) || i.a.toLowerCase().includes(term)) })).filter((s) => s.items.length > 0);
  }, [q]);

  const totalHits = sections.reduce((a, s) => a + s.items.length, 0);

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh"><h1>Help Center</h1><div className="sub">Guides, FAQs and platform status for Super Admins.</div></div>

      <div className="grid3">
        <section className="panel" style={{ gridColumn: 'span 2' }}>
          <h2>How can we help?</h2>
          <input className="inp" style={{ width: '100%', height: 40, padding: '0 14px', border: '1px solid var(--line)', borderRadius: 10, fontSize: 14 }} placeholder="Search help topics… (e.g. payments, MFA, devices)" value={q} onChange={(e) => setQ(e.target.value)} />
          {q ? <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{totalHits} topic{totalHits === 1 ? '' : 's'} match “{q}”.</div> : null}
        </section>
        <section className="panel">
          <h2>System Status</h2>
          {health ? (
            <div className="s" style={{ lineHeight: 1.9, fontSize: 12.5 }}>
              <div><span className={'pill ' + (health.ok !== false && health.database?.ok ? 'ok' : 'warn')}>{health.ok !== false && health.database?.ok ? '● All Systems Operational' : '○ Degraded'}</span></div>
              <div><span className="muted">Database:</span> {health.database?.ok ? `Operational${health.database?.latencyMs != null ? ` · ${health.database.latencyMs}ms` : ''}` : 'Unavailable'}</div>
              <div><span className="muted">Uptime:</span> {uptime(health.process?.uptimeSeconds)} <span className="muted">· {health.process?.env || '—'}</span></div>
            </div>
          ) : <div className="muted" style={{ fontSize: 12 }}>Status unavailable.</div>}
        </section>
      </div>

      {sections.length === 0 ? <section className="panel"><div className="state">No help topics match “{q}”. Try a different term.</div></section> : sections.map((s) => (
        <section className="panel" key={s.section}>
          <h2>{s.section}</h2>
          <div className="grid2" style={{ marginTop: 4 }}>
            {s.items.map((i) => (
              <div key={i.q} style={{ border: '1px solid var(--line,#eee)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{i.q}</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{i.a}</div>
                {i.to ? <button className="linkbtn" style={{ marginTop: 6, fontSize: 12 }} onClick={() => nav(i.to!)}>Open →</button> : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="panel">
        <h2>Support & Resources</h2>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
          The in-app guides above link straight to the relevant admin areas. A searchable knowledge-base CMS and an
          in-app support-ticketing system aren’t built into the console yet —
          <span style={{ color: 'var(--danger,#B85B4D)' }}> not connected</span>. For the public help center, visit the
          AIPowerSalon marketing site.
        </div>
        <div className="qgrid" style={{ marginTop: 10 }}>
          {[
            { l: 'All Tenants', to: '/tenants' },
            { l: 'Billing', to: '/subscriptions' },
            { l: 'Integrations', to: '/integrations' },
            { l: 'Security', to: '/security-compliance' },
            { l: 'Audit Logs', to: '/audit-logs' },
            { l: 'Settings', to: '/settings' },
          ].map((a) => <button key={a.l} className="qbtn" onClick={() => nav(a.to)}>{a.l}</button>)}
        </div>
      </section>
    </div>
  );
}
