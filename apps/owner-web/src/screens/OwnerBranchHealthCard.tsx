// OwnerBranchHealthCard.tsx — BUILD_PLAN Phase 14 B (Constitution 11 §345): the owner's own branches' operational health,
// from the 15-minute snapshot (GET /owner/branch-health — the session's salon only). Worst branch first; each says why.
// A fact that was not measured shows "—" (never 0); a branch not snapshotted yet says so. No permission → the card hides.
import { useEffect, useState } from 'react';
import type { BranchHealthSnapshot, BranchHealthStatus, OwnerBranchHealth } from '@aipowersalon/api-contracts/tenant';
import { ownerBranchHealthApi } from '../api/ownerBranchHealthApi';

const RANK: Record<BranchHealthStatus, number> = { OUTAGE: 0, DEGRADED: 1, UNKNOWN: 2, HEALTHY: 3 };
const COLOR: Record<BranchHealthStatus, string> = { HEALTHY: '#3E8F57', DEGRADED: '#A0711B', OUTAGE: '#B85B4D', UNKNOWN: '#6B6B6B' };
const LABEL: Record<BranchHealthStatus, string> = { HEALTHY: 'Healthy', DEGRADED: 'Needs attention', OUTAGE: 'Problem', UNKNOWN: 'Unknown' };
/** the API's reason codes in owner words */
const REASON: Record<string, string> = {
  payments_failing: 'most payments are failing', payment_failures: 'some payments are failing', long_wait: 'a guest has waited a long time',
  devices_offline_while_open: 'displays and kiosks are offline while open', idle: 'no activity right now', sms_failing: 'text messages are failing',
};
const reasonText = (r: string) => (r.startsWith('query_failed:') ? `could not measure ${r.slice('query_failed:'.length)}` : REASON[r] ?? r.replace(/_/g, ' '));
const n = (v: number | null) => (v == null ? '—' : String(v));
const of = (a: number | null, b: number | null) => (a == null || b == null ? '—' : `${a}/${b}`);
const wait = (s: number | null) => (s == null ? '—' : `${Math.round(s / 60)} min`);

export function OwnerBranchHealthCard({ branchId }: { branchId?: string }) {
  const [data, setData] = useState<OwnerBranchHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let live = true;
    ownerBranchHealthApi.get().then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: any) => { if (!live) return; if (e?.status === 403) setHidden(true); else setError('Branch health could not be loaded.'); });
    return () => { live = false; };
  }, []);

  if (hidden) return null;
  if (error) return <div className="owner-state" role="alert">{error}</div>;
  if (!data) return null;
  const rows = data.branches
    .filter((b) => !branchId || b.branchId === branchId)
    .sort((a, b) => (a.snapshot ? RANK[a.snapshot.overall] : 2.5) - (b.snapshot ? RANK[b.snapshot.overall] : 2.5));
  return (
    <section data-testid="owner-branch-health" style={{ marginTop: 16 }}>
      <div className="owner-sechead"><div className="h">Branch Health</div><div className="d">every 15 minutes</div></div>
      {rows.length === 0 ? <div className="owner-state">No branches.</div> : (
        <div className="owner-drill">
          {rows.map((b) => <BranchRow key={b.branchId} name={b.branchName ?? 'Branch'} s={b.snapshot} />)}
        </div>
      )}
    </section>
  );
}

function BranchRow({ name, s }: { name: string; s: BranchHealthSnapshot | null }) {
  if (!s) return (
    <div className="owner-drillrow" data-testid="bh-row">
      <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{name}</div><div className="owner-text-muted" style={{ fontSize: 12 }}>Not checked yet — the first check runs within 15 minutes.</div></div>
    </div>
  );
  // the API lists each failed fact as `query_failed:<fact>` in reasons; 'ok' is not worth saying
  const why = s.reasons.filter((r) => r !== 'ok').map(reasonText);
  return (
    <div className="owner-drillrow" data-testid="bh-row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{name}</div>
        {why.length ? <div style={{ fontSize: 12, color: COLOR[s.overall] }}>{why.join(' · ')}</div> : null}
        <div className="owner-text-muted" style={{ fontSize: 12 }}>
          {n(s.openTickets)} open tickets · {n(s.queueWaiting)} waiting (longest {wait(s.queueLongestWaitSeconds)}) · {n(s.techniciansOnShift)} on shift
        </div>
        <div className="owner-text-muted" style={{ fontSize: 12 }}>
          Payments last hour {n(s.paymentsLastHour)} ({n(s.paymentsFailedLastHour)} failed) · Displays {of(s.displaysOnline, s.displaysTotal)} · Kiosks {of(s.kiosksOnline, s.kiosksTotal)} online
        </div>
      </div>
      <span style={{ marginLeft: 10, fontWeight: 700, fontSize: 12, color: COLOR[s.overall] }}>{LABEL[s.overall]}</span>
    </div>
  );
}
