// EmploymentHistoryPanel.tsx — Technician Profile mandate §128: THIS salon's employment history of one technician
// (hired · rehired · role changed · branch added/removed · suspended · reactivated · terminated · transferred out · leave).
// Read-only; append-only on the server (646). Tenant-private — never part of a public projection. Honest states:
// loading, a server error (data stays if it loaded once), and "no history yet".
import { useCallback, useEffect, useState } from 'react';
import { posTechniciansApi, type EmploymentHistoryRow } from '../api/posTechniciansApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
const tone = (t: string) => (['hired', 'rehired', 'reactivated', 'branch_added'].includes(t) ? '#2E7D32' : ['terminated', 'transferred', 'suspended', 'branch_removed'].includes(t) ? '#C0392B' : '#8A7A6D');

export function EmploymentHistoryPanel({ technicianId, compact }: { technicianId: string; compact?: boolean }) {
  const [rows, setRows] = useState<EmploymentHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    posTechniciansApi.employmentHistory(technicianId).then((r) => { setRows(Array.isArray(r?.events) ? r.events : []); setError(null); })
      .catch((e: any) => setError(e?.message || tx('pos.could_not_load_the_employment_history')));
  }, [technicianId]);
  useEffect(() => { load(); }, [load]);
  const shown = compact && rows ? rows.slice(0, 5) : rows;
  return (
    <section aria-label={tx('pos.employment_history')} style={{ display: 'grid', gap: 6 }}>
      {error ? <div className="err" style={{ fontSize: 12 }}>{error}</div> : null}
      {!rows && !error ? <div className="muted" style={{ fontSize: 12 }}>{tx('pos.loading_history')}</div> : null}
      {rows && rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>{tx('pos.no_employment_history_recorded_yet')}</div> : null}
      {shown?.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #EFEAE1' }}>
          <div className="muted">{fmt(r.occurredAt)}{r.endsAt ? ` – ${fmt(r.endsAt)}` : ''}</div>
          <div>
            <span style={{ fontWeight: 700, color: tone(r.type) }}>{r.label}</span>
            {r.type === 'role_changed' && (r.from || r.to) ? <span className="muted"> · {r.from ?? '—'} → {r.to ?? '—'}</span> : null}
            {r.type === 'hired' || r.type === 'rehired' ? (r.to ? <span className="muted"> {tx('pos.as')}{' '}{r.to}</span> : null) : null}
            {r.branchName ? <span className="muted"> · {r.branchName}</span> : null}
            {r.reason ? <div className="muted" style={{ fontSize: 11.5 }}>{tx('pos.reason')}{' '}{r.reason}</div> : null}
            {r.actorName ? <div className="muted" style={{ fontSize: 11 }}>{tx('pos.by')}{' '}{r.actorName}</div> : null}
          </div>
        </div>
      ))}
      {compact && rows && rows.length > 5 ? <div className="muted" style={{ fontSize: 11 }}>{rows.length - 5} {tx('pos.earlier_event')}{enPlural(rows.length - 5 === 1 ? '' : 's')} {tx('pos.open_the_employment_section_for_all')}</div> : null}
    </section>
  );
}
