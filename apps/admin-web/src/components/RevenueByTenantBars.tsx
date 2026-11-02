// Revenue by Tenant (Top 10) — reference module. Pure + presentational: consumes the SAME ranked rows the
// Top Performing Tenants card uses (the existing topPerformingTenants endpoint — monthly card volume + growth%),
// so the two modules reconcile and there's no duplicate data source. Cream/gold horizontal bars.

export interface RevenueByTenantRow {
  tenantId: string;
  salonName: string;
  monthlyCardVolume: number;            // integer cents (for the bar width)
  formattedMonthlyCardVolume: string;   // pre-formatted by the backend
  growthPercent: number | null;
}

export function RevenueByTenantBars({ rows, onTenant }: { rows: RevenueByTenantRow[]; onTenant?: (id: string) => void }) {
  if (!rows || rows.length === 0) return <div className="state">No tenant revenue yet.</div>;
  const max = Math.max(1, ...rows.map((r) => r.monthlyCardVolume || 0));
  return (
    <div role="list" aria-label="Revenue by tenant">
      {rows.slice(0, 10).map((r) => (
        <div className="legrow" role="listitem" key={r.tenantId} style={{ cursor: onTenant ? 'pointer' : 'default', alignItems: 'center' }} onClick={() => onTenant?.(r.tenantId)} title={r.salonName}>
          <span className="legl" style={{ flex: '0 0 130px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.salonName}</span>
          <span className="pgbar" style={{ flex: 1 }}><span style={{ width: `${Math.round(((r.monthlyCardVolume || 0) / max) * 100)}%`, background: 'var(--g7)' }} /></span>
          <span className="legv" style={{ flex: '0 0 96px', textAlign: 'right' }}>
            {r.formattedMonthlyCardVolume}
            {r.growthPercent != null ? <span className={r.growthPercent >= 0 ? 'up' : 'down'} style={{ marginLeft: 6, fontSize: 11 }}>{r.growthPercent >= 0 ? '▲' : '▼'}{Math.abs(r.growthPercent)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
