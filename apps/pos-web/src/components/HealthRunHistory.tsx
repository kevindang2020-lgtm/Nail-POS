// HealthRunHistory — audit B1–B4 (Nov 4 2026): "Run check" records a run of the read-only coupon / deal diagnostics, and the
// history below lists each run newest first (when, who, overall, what needed attention). Shared by Coupons and Deals & Offers.
import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';
import { Pager } from './FitKit';

type Run = { id: string; overall: string; at: string | null; by: string | null; attention: string[]; trigger?: 'manual' | 'scheduled' };
type Page = { items: Run[]; page: number; pageSize: number; totalItems: number; totalPages: number };
const TONE: Record<string, string> = { ready: 'ok', unknown: 'mut', attention: 'warn', failed: 'bad' };

export function HealthRunHistory({ run, list, checkLabel, onRan }: { run: () => Promise<unknown>; list: (q: { page: number; pageSize: number }) => Promise<Page>; checkLabel: (key: string) => string; onRan?: () => void }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<Page | null>(null); const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [tick, setTick] = useState(0);
  useEffect(() => { let alive = true; Promise.resolve().then(() => list({ page, pageSize: 5 })).then((x) => { if (alive) { setD(x); setErr(null); } }).catch((e) => alive && setErr(String((e as Error)?.message ?? e))); return () => { alive = false; }; }, [page, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => { setBusy(true); try { await run(); setPage(1); setTick((t) => t + 1); onRan?.(); } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); } };
  return (
    <div className="health-history" data-testid="health-history">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 6px' }}>
        <b>{tx('cp.healthHistory')}</b>
        <button type="button" className="fk-btn sm" disabled={busy} onClick={() => void go()} data-testid="health-run">{busy ? tx('pos.loading') : tx('cp.healthRun')}</button>
      </div>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <div className="fk-hint">{tx('cp.healthNoRuns')}</div> : <>
        <table className="fk-table" data-testid="health-runs"><tbody>{d.items.map((r) => <tr key={r.id} data-testid="health-run-row">
          <td>{r.at ? fmtInZone(r.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td><td>{r.by ?? (r.trigger === 'scheduled' ? tx('cp.healthScheduled') : '—')}</td>
          <td><span className={'fk-chip ' + (TONE[r.overall] ?? 'mut')}>{tx('cp.health.' + r.overall)}</span></td>
          <td className="fk-muted">{r.attention.length ? r.attention.map(checkLabel).join(' · ') : tx('cp.healthAllClear')}</td></tr>)}</tbody></table>
        {d.totalPages > 1 ? <Pager compact info={d} onPage={setPage} /> : null}
      </>}
    </div>
  );
}
