// accountFinder.tsx — Account Finder (extras: Account Claude Guide 15, "Account Finder and controlled search").
// Finds the EXISTING Account modules and settings by title, keyword or description. It searches a fixed list of places
// in this app — never salon data, never another salon: the destinations are the sidebar's own ACCOUNT items (TENANT_NAV,
// gated exactly like the sidebar with gateFor — a place the person may not open is not listed) and the panels on this
// page. People (by name or phone) are found by the Team directory's own server search, scoped to the signed-in salon;
// the finder only points there when the person holds that page's permission. Nothing here reads or changes data.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TENANT_NAV } from '../shell/tenant-nav';
import { gateFor, type NavAccess } from '../shell/tenant-access';

export type AccountFinderPlace = {
  id: string;
  title: string;
  description: string;
  keywords: string;
  /** a route in this app, or an in-page panel selector */
  to: { route: string } | { panel: string };
};

/** in-page panels of the Account screen (data-testid of the panel) */
const PANELS: Array<{ id: string; panel: string; titleKey: string }> = [
  { id: 'panel-profile', panel: 'acx-panel-profile', titleKey: 'pos.account_profile' },
  { id: 'panel-business', panel: 'acx-panel-business', titleKey: 'pos.business_brand_details' },
  { id: 'panel-security', panel: 'acx-panel-security', titleKey: 'pos.security_access' },
  { id: 'panel-notif', panel: 'acx-notif', titleKey: 'acx.find.notifTitle' },
  { id: 'panel-billing', panel: 'acx-panel-billing', titleKey: 'pos.subscription_billing' },
  { id: 'panel-role', panel: 'acx-panel-role', titleKey: 'pos.role_access_overview' },
  { id: 'panel-activity', panel: 'acx-panel-activity', titleKey: 'pos.recent_account_activity' },
  { id: 'panel-health', panel: 'acx-panel-health', titleKey: 'pos.account_health_score' },
  { id: 'panel-compliance', panel: 'acx-panel-compliance', titleKey: 'pos.compliance_score' },
  { id: 'panel-backup', panel: 'acx-panel-backup', titleKey: 'pos.backup_data_health' },
];
/** sidebar items (outside the ACCOUNT section) the finder may also point to — people and roles */
const EXTRA_NAV = ['team-members', 'team-permissions'];

const desc = (id: string) => tx(`acx.find.d.${id}`);
const kw = (id: string) => tx(`acx.find.k.${id}`);

/** every place the finder knows, filtered to what this person may open (same gate as the sidebar) */
export function accountFinderPlaces(access: Pick<NavAccess, 'permissions' | 'features' | 'aiPackages' | 'subscriptionStatus'>): AccountFinderPlace[] {
  const out: AccountFinderPlace[] = [];
  const seen = new Set<string>();
  for (const s of TENANT_NAV) {
    for (const it of s.items) {
      if (s.id !== 'ACCOUNT' && !EXTRA_NAV.includes(it.id)) continue;
      if (gateFor(it, access) !== 'ok') continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ id: it.id, title: it.label, description: desc(it.id), keywords: kw(it.id), to: { route: it.route } });
    }
  }
  for (const p of PANELS) out.push({ id: p.id, title: tx(p.titleKey), description: desc(p.id), keywords: kw(p.id), to: { panel: p.panel } });
  return out;
}

/** lower case, accents removed (so "bao mat" finds "Bảo mật"), single spaces */
export const foldText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

/** every word of the query must appear in the title, description or keywords; title hits rank first */
export function searchAccountFinder(places: AccountFinderPlace[], query: string): AccountFinderPlace[] {
  const words = foldText(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const scored: Array<{ p: AccountFinderPlace; score: number; i: number }> = [];
  places.forEach((p, i) => {
    const title = foldText(p.title); const all = `${title} ${foldText(p.description)} ${foldText(p.keywords)}`;
    if (!words.every((w) => all.includes(w))) return;
    scored.push({ p, score: words.filter((w) => title.includes(w)).length, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.p);
}

/** a query with phone digits, or one no Account place matches (likely a name), points to the Team directory's own search */
const looksLikePhone = (q: string) => q.replace(/\D/g, '').length >= 3;

export function AccountFinder({ access }: { access: Pick<NavAccess, 'permissions' | 'features' | 'aiPackages' | 'subscriptionStatus'> }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const places = useMemo(() => accountFinderPlaces(access), [access]);
  const hits = useMemo(() => searchAccountFinder(places, q), [places, q]);
  const team = places.find((p) => p.id === 'team-members');
  const open = (p: AccountFinderPlace) => {
    if ('route' in p.to) { nav(p.to.route); return; }
    const el = document.querySelector(`[data-testid="${p.to.panel}"]`);
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const trimmed = q.trim();
  return (
    <section className="panel" data-testid="acx-finder">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, fontFamily: "'Playfair Display', serif" }}>{tx('acx.find.title')}</div>
        <div className="fn-search" style={{ flex: 1, minWidth: 220 }}>
          <input className="fk-search wide" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('acx.find.ph')} aria-label={tx('acx.find.ph')} data-testid="acx-finder-q" />
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{tx('acx.find.scope')}</div>
      {trimmed ? (
        <div className="list" style={{ marginTop: 8, maxHeight: 'none' }} data-testid="acx-finder-results">
          {hits.length === 0 ? <div className="muted" style={{ padding: '6px 4px', fontSize: 12 }} data-testid="acx-finder-none">{tx('acx.find.none')}</div> : hits.slice(0, 8).map((p) => (
            <button key={p.id} type="button" className="row" data-testid={`acx-finder-hit-${p.id}`} onClick={() => open(p)} style={{ textAlign: 'left', width: '100%', background: 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', padding: '7px 4px' }}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 12.5 }}>{p.title}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.description}</div></div>
              <span className="pill mut" style={{ fontSize: 10.5 }}>{'route' in p.to ? tx('acx.find.page') : tx('acx.find.onThisPage')}</span>
            </button>
          ))}
          {team && (looksLikePhone(trimmed) || hits.length === 0) ? (
            <button type="button" className="btn ghost whitespace-nowrap w-fit" style={{ marginTop: 6 }} data-testid="acx-finder-people" onClick={() => open(team)}>{tx('acx.find.people')}</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
