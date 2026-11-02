import { ReactNode } from 'react';

// _chartkit.tsx — shared inline visual primitives for the S-series platform screens (donut, semicircle gauge, mini
// bar chart) + money/date helpers. SVG only, cream/gold palette, all guarded for empty data ("no data yet") so screens
// render honestly when the seed is empty. No external chart deps.

export const PALETTE = ['#A96F22', '#3C7FB6', '#3E8F57', '#C98A3A', '#7B5BB6', '#B85B4D', '#5BA8A0', '#C2557A'];
export const money = (c: number | null | undefined) => '$' + ((c ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const moneyK = (c: number) => { const v = (c ?? 0) / 100; return v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0); };
export const dt = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch { return String(iso); } };
export const dd = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(); } catch { return String(iso); } };

export function Donut({ data, centerLabel, hideLegend }: { data: { label: string; value: number }[]; centerLabel?: string; hideLegend?: boolean }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const R = 52, C = 2 * Math.PI * R; let off = 0;
  if (total === 0) return <div className="state" style={{ fontSize: 12 }}>No data yet.</div>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" style={{ flexShrink: 0 }}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--line,#eee)" strokeWidth="16" />
        {data.map((d, i) => { const len = (d.value / total) * C; const el = <circle key={i} cx="64" cy="64" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 64 64)" />; off += len; return el; })}
        <text x="64" y={centerLabel ? 58 : 62} textAnchor="middle" fontSize={centerLabel ? 13 : 20} fontWeight="700" fill="var(--ink,#2A2018)">{centerLabel || total}</text>
        <text x="64" y={centerLabel ? 74 : 78} textAnchor="middle" fontSize="10" fill="var(--muted,#8a7d6d)">{centerLabel ? 'Total' : 'Total'}</text>
      </svg>
      {!hideLegend && (
      <div style={{ flex: 1, minWidth: 0 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 3 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
            <span style={{ fontWeight: 700 }}>{d.value}</span>
            <span className="muted" style={{ width: 42, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

export function Gauge({ pct, label }: { pct: number; label: string }) {
  const R = 54, cx = 70, cy = 70; const a = Math.PI * (1 - Math.min(1, Math.max(0, pct / 100)));
  const x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
  const arc = (sx: number, sy: number, ex: number, ey: number) => `M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`;
  const col = pct >= 80 ? '#3E8F57' : pct >= 50 ? '#C98A3A' : '#B85B4D';
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width="140" height="84" viewBox="0 0 140 84">
        <path d={arc(cx - R, cy, cx + R, cy)} fill="none" stroke="var(--line,#eee)" strokeWidth="12" strokeLinecap="round" />
        <path d={arc(cx - R, cy, x, y)} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round" />
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink,#2A2018)">{pct}%</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize="10" fill="var(--muted,#8a7d6d)">{label}</text>
      </svg>
    </div>
  );
}

export function MiniBars({ data, emptyHint }: { data: { label: string; value: number; tip?: string }[]; emptyHint?: string }) {
  if (!data.length) return <div className="state" style={{ fontSize: 12 }}>{emptyHint || 'No history yet.'}</div>;
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200, padding: '8px 0' }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink,#2A2018)' }}>{d.value}</div>
            <div title={d.tip} style={{ width: '70%', maxWidth: 38, height: `${Math.max(4, (d.value / max) * 90)}px`, background: 'linear-gradient(180deg,#C98A3A,#A96F22)', borderRadius: '4px 4px 0 0' }} />
            <div className="muted" style={{ fontSize: 10 }}>{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NotConnected({ children }: { children?: ReactNode }) {
  return <span className="text-red-700">{children || 'not connected'}</span>;
}

// Filled line/area chart for revenue & growth trends. Guarded for empty data so it renders honestly when there's no series.
export function AreaLine({ series, height = 150, emptyHint }: { series: { label: string; valueCents: number }[]; height?: number; emptyHint?: string }) {
  if (!series.length) return <div className="state" style={{ fontSize: 12 }}>{emptyHint || 'No data yet.'}</div>;
  const W = 560, H = height, pad = 26;
  const max = Math.max(1, ...series.map((s) => s.valueCents));
  const stepX = series.length > 1 ? (W - pad * 2) / (series.length - 1) : 0;
  const pts = series.map((s, i) => [pad + i * stepX, H - pad - (s.valueCents / max) * (H - pad * 2)] as const);
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L ${pts[pts.length - 1][0].toFixed(1)} ${H - pad} L ${pad} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="Trend">
      {[0, 0.5, 1].map((g) => (<line key={g} x1={pad} x2={W - pad} y1={pad + g * (H - pad * 2)} y2={pad + g * (H - pad * 2)} stroke="var(--line,#eee)" strokeWidth="1" />))}
      <path d={area} fill="rgba(169,111,34,.10)" />
      <path d={path} fill="none" stroke="#A96F22" strokeWidth="2.5" />
      {pts.map((p, i) => (<g key={i}><circle cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke="#A96F22" strokeWidth="2" /><title>{series[i].label}</title></g>))}
      {series.map((s, i) => i % Math.ceil(series.length / 8 || 1) === 0 ? (<text key={i} x={pad + i * stepX} y={H - 6} fontSize="9" fill="var(--muted,#8a7d6d)" textAnchor="middle">{s.label}</text>) : null)}
    </svg>
  );
}
