// liveScheduleStaffing.tsx — 200-technician 02 (Shift-Aware Staffing Heatmap) on the Live Technician Schedule: the server's
// per-hour counts over the WHOLE (filtered) roster — on shift, ready, booked, planned break; late / on break only for the
// current hour of today — and a cell opens the technicians behind it (each opens their full day). Read-only; nothing here
// is computed from the page of lanes.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { hm12 } from './teamShared';

type Bucket = 'ready' | 'booked' | 'onBreak' | 'late' | 'breakNow';
type StaffingBand = { start: string; end: string; isNow: boolean; onShift: number; ready: number; booked: number; onBreak: number; late: number | null; breakNow: number | null; ids: Record<Bucket, string[]> };
export type StaffingMap = { date: string; live: boolean; bands: StaffingBand[]; names: Record<string, string> };
const ROWS: Bucket[] = ['ready', 'booked', 'onBreak', 'late', 'breakNow'];

export function StaffingHeatmap({ h, onTech }: { h: StaffingMap; onTech: (id: string) => void }) {
  const [pick, setPick] = useState<{ band: StaffingBand; row: Bucket } | null>(null);
  const max = Math.max(1, ...h.bands.map((b) => b.onShift));
  if (!h.bands.some((b) => b.onShift > 0)) return <p className="fk-hint" data-testid="staffing-none">{tx('ls.st.none')}</p>;
  return (
    <div data-testid="staffing-heatmap">
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ minWidth: 0 }}>
          <thead><tr><th />{h.bands.map((b) => <th key={b.start} className="t-num" data-testid={'staffing-col-' + b.start}>{hm12(b.start)}{b.isNow ? <div className="sub">{tx('ls.st.now')}</div> : null}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">{tx('ls.st.row.onShift')}</th>{h.bands.map((b) => <td key={b.start} className="t-num">{b.onShift}</td>)}</tr>
            {ROWS.map((r) => <tr key={r}><th scope="row">{tx('ls.st.row.' + r)}</th>{h.bands.map((b) => {
              const n = b[r];
              if (n == null) return <td key={b.start} className="t-num sub">—</td>;
              const alpha = n > 0 ? 0.12 + 0.55 * (n / max) : 0;
              const tint = r === 'ready' ? '46,125,50' : r === 'booked' ? '44,91,147' : r === 'late' ? '178,59,59' : '201,151,27';
              return <td key={b.start} className="t-num" style={{ background: n > 0 ? `rgba(${tint},${alpha.toFixed(2)})` : undefined }}>
                {n > 0 ? <button type="button" className="fk-link" aria-label={tx('ls.st.cell', { row: tx('ls.st.row.' + r), start: hm12(b.start), n: String(n) })} onClick={() => setPick({ band: b, row: r })} data-testid={`staffing-${r}-${b.start}`}>{n}</button> : '0'}</td>;
            })}</tr>)}
          </tbody>
        </table>
      </div>
      {pick ? <div className="fk-note info" data-testid="staffing-who">
        <b>{tx('ls.st.who', { row: tx('ls.st.row.' + pick.row), start: hm12(pick.band.start), end: hm12(pick.band.end) })}</b>
        <ul className="fk-list dense">{pick.band.ids[pick.row].map((id) => <li key={id} className="fk-li"><button type="button" className="fk-link" onClick={() => onTech(id)} data-testid="staffing-who-tech">{h.names[id] ?? '—'}</button></li>)}</ul>
      </div> : null}
    </div>
  );
}
