// PlatformSearchBox — Constitution 7 §140–§141: the shell's search box queries the permission-aware platform search and
// shows grouped results (tenants, branches, platform staff, support tickets). What the server did not return because the
// signed-in role cannot see it is simply absent. Enter with no pick keeps the old behaviour: search the Tenants list.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';

import type { PlatformSearchHit as Hit, PlatformSearchResult } from '@aipowersalon/api-contracts/platform';
const LABEL: Record<Hit['kind'], string> = { tenant: 'Tenants', branch: 'Branches', platform_user: 'Platform staff', support_ticket: 'Support tickets' };
const target = (h: Hit) => h.kind === 'tenant' ? `/tenants?tenantId=${encodeURIComponent(h.id)}`
  : h.kind === 'branch' ? `/tenants?tenantId=${encodeURIComponent(h.tenantId ?? '')}`
  : h.kind === 'platform_user' ? '/platform-staff'
  : `/support-access?ticket=${encodeURIComponent(h.id)}`;

export function PlatformSearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState<Array<{ kind: Hit['kind']; hits: Hit[] }>>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setGroups([]); return; }
    const my = ++seq.current;
    const t = setTimeout(() => {
      Promise.resolve().then(() => superAdminApi.platformSearch(term))
        .then((r: PlatformSearchResult) => { if (my === seq.current) { setGroups(Array.isArray(r?.groups) ? r.groups : []); setOpen(true); } })
        .catch(() => { if (my === seq.current) setGroups([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const go = (to: string) => { setOpen(false); setQ(''); nav(to); };
  return (
    <div className="search" style={{ position: 'relative' }}>
      <input placeholder="Search anything…" aria-label="Platform search" value={q}
        onChange={(e) => setQ(e.target.value)} onFocus={() => groups.length && setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(`/tenants?search=${encodeURIComponent(q)}`); if (e.key === 'Escape') setOpen(false); }} />
      <button className="searchbtn" aria-label="Search" onClick={() => go(`/tenants?search=${encodeURIComponent(q)}`)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      </button>
      {open && groups.length ? (
        <div role="listbox" data-testid="platform-search-results" className="panel"
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4, maxHeight: 360, overflowY: 'auto' }}>
          {groups.map((g) => (
            <div key={g.kind}>
              <div className="muted" style={{ fontSize: 11, padding: '6px 10px 2px' }}>{LABEL[g.kind]}</div>
              {g.hits.map((h) => (
                <button key={g.kind + h.id} role="option" className="linkbtn" onClick={() => go(target(h))}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px' }}>
                  {h.title}{h.subtitle ? <span className="muted" style={{ fontSize: 12 }}> · {h.subtitle}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
