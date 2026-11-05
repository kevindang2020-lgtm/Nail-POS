import { useEffect, useState } from 'react';
import { ownerStaffApi, type OwnerTechnicianDetail, type OwnerPeriod } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { PeriodSelector } from '../components/PeriodSelector';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// TechnicianDetailScreen — Module 4 drill-in. Real per-technician metrics from /owner/staff/:id/performance.
const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="owner-kpi"><div className="label">{label}</div><div className="val" style={{ fontSize: 18 }}>{value}</div></div>;
}

export function TechnicianDetailScreen({ technicianId }: { technicianId: string }) {
  const { back } = useOwnerNav();
  const [period, setPeriod] = useState<OwnerPeriod>('week');
  const [d, setD] = useState<OwnerTechnicianDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true); setErr(null);
    ownerStaffApi.technician(technicianId, period)
      .then(setD)
      .catch((e: any) => setErr(e?.status === 404 ? 'Technician not found.' : e?.status === 403 ? 'You do not have access to this.' : e?.message || 'Unable to load technician.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [technicianId, period]);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>{d?.fullName ?? 'Technician'}</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '12px 16px 0' }}><PeriodSelector value={period} onChange={setPeriod} /></div>

      {err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : (
        <>
          <section className="owner-hero" aria-label="Sales">
            <div className="label">SALES · THIS PERIOD</div>
            <div className="val">{loading && !d ? <div className="owner-skel" style={{ width: 120, height: 40, margin: '0 auto', borderRadius: 8 }} /> : money(d!.salesCents)}</div>
            <div className="trend">{loading && !d ? <div className="owner-skel" style={{ width: 140, height: 16, margin: '4px auto 0' }} /> : `${d!.servicesCompleted} services · ★ ${d!.rating ? d!.rating.toFixed(1) : '—'} (${d!.reviewCount})`}</div>
          </section>
          <div className="owner-detailgrid">
            {loading && !d ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div className="owner-kpi" key={i}>
                  <div className="owner-skel" style={{ width: 80, height: 12, marginBottom: 8 }} />
                  <div className="owner-skel" style={{ width: 60, height: 24 }} />
                </div>
              ))
            ) : (
              <>
                <Stat label="Tips" value={money(d!.tipsCents)} />
                <Stat label="Commission" value={money(d!.commissionCents)} />
                <Stat label="Average Ticket" value={money(d!.averageTicketCents)} />
                <Stat label="Bookings" value={String(d!.bookingCount)} />
                <Stat label="Utilization" value={`${d!.utilizationPercent}%`} />
                <Stat label="Payroll Est." value={money(d!.payrollEstimateCents)} />
              </>
            )}
          </div>
          <div className="owner-chartcard" style={{ marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Utilization = {loading && !d ? '...' : d!.busyMinutes} busy min ÷ {loading && !d ? '...' : d!.scheduledMinutes} scheduled min. Payroll estimate = commission + tips (an estimate;
              accounting-grade payroll is computed in the POS).
            </div>
          </div>
        </>
      )}
    </>
  );
}
