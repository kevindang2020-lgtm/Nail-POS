// technicianScreenParts.tsx — the three priority flows of the Technicians Management Center (Oct 30 2026):
//   TechnicianProfileOverlay  Overview · Qualified Services · Schedule · Appointments · Performance · Earnings (authorized) ·
//                             Gallery · History — each tab reads only its own authorized records; Close / Esc returns
//   QualifiedFinder           service(s) + date → the BOOKING ENGINE's openings (GET /pos/booking/openings: mapping, shift,
//                             breaks, time off, appointments and the full service duration — one continuous gap); Select
//                             opens the existing New Booking flow, which re-checks the slot on save
//   MappingAssistant          technicians with no service mapping → the whole catalog, nothing pre-ticked → PATCH
//                             /pos/technicians/:id/services (the one eligibility writer, audited per grant / revoke)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTechniciansScreenApi } from '../api/posTeamScreensApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { posLiveTechnicianScheduleApi } from '../api/posLiveTechnicianScheduleApi';
import { posBookingApi } from '../api/posBookingApi';
import { posCatalogApi } from '../api/posCatalogApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, Pager, Empty, useDebounced } from '../components/FitKit';
import { useLoad, StateBlock } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { ConflictPanel } from './teamShared';
type Rating = { ratingId?: string; id?: string; rating?: number; stars?: number; comment?: string | null };
const ratingList = (d: unknown): Rating[] => (Array.isArray(d) ? d : Array.isArray((d as { items?: unknown } | null)?.items) ? (d as { items: Rating[] }).items : []);
export const roleText = (r: string) => codeLabel('people.techs.role.' + r.toLowerCase().replace(/\s+/g, '_'), r);

export const nf = (n: number | null | undefined) => fmtNumber(n || 0);
export const pageOf = (d: any) => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages } : null);
export const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
export const ratingText = (r: number | null | undefined, n: number) => (r == null || !n ? tx('tc.unrated') : tx('tc.ratingV', { r: r.toFixed(1), n: nf(n) }));
export const WORK_TONE: Record<string, string> = { available: 'ok', in_service: 'info', assigned: 'info', on_break: 'warn', on_shift: 'ok', off: 'mut' };
const hm12 = (hhmm?: string | null) => { if (!hhmm) return '—'; const [h, m] = hhmm.split(':').map(Number); if (!Number.isFinite(h)) return hhmm; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const addMin = (hhmm: string, mins: number) => { const [h, m] = hhmm.split(':').map(Number); const t = h * 60 + m + mins; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

type PTab = 'overview' | 'services' | 'schedule' | 'appointments' | 'performance' | 'earnings' | 'gallery' | 'history';
export function TechnicianProfileOverlay({ technicianId, canPay, canEdit, onClose, onEdit, onMapping }: { technicianId: string; canPay: boolean; canEdit: boolean; onClose: () => void; onEdit: () => void; onMapping: () => void }) {
  const nav = useNavigate();
  const [t, setT] = useState<PTab>('overview'); const [ap, setAp] = useState(1); const [apScope, setApScope] = useState<'upcoming' | 'past'>('upcoming'); const [hp, setHp] = useState(1); const [sp, setSp] = useState(1);
  const tabs: PTab[] = ['overview', 'services', 'schedule', 'appointments', 'performance', ...(canPay ? ['earnings' as const] : []), 'gallery', 'history'];
  const d = useLoad(() => (t === 'earnings' ? posTechniciansApi.detail(technicianId) : Promise.resolve(null)), [technicianId, t]);
  const row = useLoad(() => posTechniciansScreenApi.directory({ q: technicianId, status: 'all', pageSize: 1 }), [technicianId]);
  const svc = useLoad(() => (t === 'services' ? posTechniciansScreenApi.mapping(technicianId) : Promise.resolve(null)), [technicianId, t]);
  const live = useLoad(() => (t === 'schedule' || t === 'overview' ? posLiveTechnicianScheduleApi.detail(technicianId).catch(() => null) : Promise.resolve(null)), [technicianId, t]);
  const appts = useLoad(() => (t === 'appointments' ? posTechniciansScreenApi.appointments(technicianId, { scope: apScope, page: ap, pageSize: 8 }) : Promise.resolve(null)), [technicianId, t, apScope, ap]);
  const hist = useLoad(() => (t === 'performance' ? posTechniciansScreenApi.serviceHistory(technicianId, { preset: 'month', page: sp, pageSize: 8 }) : Promise.resolve(null)), [technicianId, t, sp]);
  const ratings = useLoad(() => (t === 'performance' ? Promise.resolve(posTechniciansApi.profileRatings(technicianId)).catch(() => null) : Promise.resolve(null)), [technicianId, t]);
  const prof = useLoad(() => (t === 'gallery' || t === 'overview' ? Promise.resolve(posTechniciansApi.techProfile(technicianId)).catch(() => null) : Promise.resolve(null)), [technicianId, t]);
  const events = useLoad(() => (t === 'history' ? posTechniciansScreenApi.history({ technicianId, page: hp, pageSize: 8 }) : Promise.resolve(null)), [technicianId, t, hp]);
  const x = d.data; const r = row.data?.items?.[0]; const lv: any = live.data; const pf: any = prof.data;
  return (
    <FitDialog wide title={r?.name ?? tx('tc.profile')} subtitle={r ? <><span className={'fk-chip ' + (WORK_TONE[r.working] ?? 'mut')}>{tx('tc.work.' + r.working)}</span> {tx('tc.account.' + (['active', 'inactive', 'suspended', 'archived'].includes(r.status) ? r.status : 'active'))} · {roleText(r.role)} · {r.code}</> : undefined}
      onClose={onClose} testId="dlg-tech-profile"
      footer={<>{canEdit ? <button type="button" className="fk-btn ghost" onClick={onMapping} data-testid="profile-mapping">{tx('tc.mapServices')}</button> : null}
        {canEdit ? <button type="button" className="fk-btn ghost" onClick={onEdit} data-testid="profile-edit">{tx('pos.edit')}</button> : null}
        <button type="button" className="fk-btn ghost" onClick={() => nav(`/technicians/${encodeURIComponent(technicianId)}`)}>{tx('tc.fullPage')}</button>
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="profile-close">{tx('pos.close')}</button></>}>
      {row.error ? <StateBlock error={row.error} onRetry={row.reload} /> : !r ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-seg mos-dtabs" role="tablist" aria-label={tx('tc.profile')}>
          {tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={t === k} className={t === k ? 'on' : ''} onClick={() => setT(k)} data-testid={'pt-' + k}>{tx('tc.ptab.' + k)}</button>)}
        </div>
        {t === 'overview' ? <dl className="fk-dl mo-dl" data-testid="pt-overview-body">
          <dt>{tx('tc.f.name')}</dt><dd>{r.name}</dd>
          <dt>{tx('tc.f.role')}</dt><dd>{roleText(r.role)}{r?.branchName ? ` · ${r.branchName}` : ''}</dd>
          <dt>{tx('tc.f.account')}</dt><dd>{tx('tc.account.' + r.status)}</dd>
          <dt>{tx('tc.f.now')}</dt><dd>{r ? tx('tc.work.' + r.working) : '—'}{lv?.activeTicket ? ` · ${lv.activeTicket.serviceSummary}` : ''}</dd>
          <dt>{tx('tc.f.app')}</dt><dd>{r ? tx('tc.app.' + r.app) : '—'}</dd>
          <dt>{tx('tc.f.contact')}</dt><dd>{r?.phone ?? '—'}{r?.email ? ` · ${r.email}` : ''}{r?.contactMasked ? <span className="fk-li-s">{tx('tc.contactMasked')}</span> : null}</dd>
          <dt>{tx('tc.f.rating')}</dt><dd>{r ? ratingText(r.rating, r.ratingCount) : '—'}</dd>
          <dt>{tx('tc.f.services')}</dt><dd>{r ? (r.qualifiedServices ? tx('tc.qualifiedN', { n: nf(r.qualifiedServices) }) : <span className="fk-chip warn">{tx('tc.noMapping')}</span>) : '—'}</dd>
          <dt>{tx('tc.f.next')}</dt><dd>{lv?.nextAppointment ? `${hm12(lv.nextAppointment.startTime)} · ${lv.nextAppointment.serviceSummary}` : tx('tc.noneToday')}</dd>
          {pf?.profile?.bio ? <><dt>{tx('tc.f.bio')}</dt><dd>{pf.profile.bio}</dd></> : null}
          <dt>{tx('tc.f.id')}</dt><dd className="mos-mono">{technicianId}</dd>
        </dl> : null}
        {t === 'services' ? (svc.error ? <StateBlock error={svc.error} onRetry={svc.reload} /> : !svc.data ? <div className="fk-loading">{tx('pos.loading')}</div> : (() => { const m = svc.data.services.filter((s: any) => s.mapped);
          return m.length === 0 ? <Empty title={tx('tc.noMapping')}>{canEdit ? <button type="button" className="fk-btn primary" onClick={onMapping}>{tx('tc.mapServices')}</button> : null}</Empty>
            : <table className="fk-table fn-table cg-table" data-testid="pt-services-body"><thead><tr><th>{tx('pos.service_3')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.duration')}</th><th className="num">{tx('tc.performed')}</th></tr></thead>
              <tbody>{m.map((s: any) => <tr key={s.serviceId}><td>{s.name}</td><td>{s.category ?? '—'}</td><td className="num">{tx('cg.min', { n: nf(s.durationMinutes) })}</td><td className="num">{nf(s.performedBefore)}</td></tr>)}</tbody></table>; })()) : null}
        {t === 'schedule' ? (live.error ? <StateBlock error={live.error} onRetry={live.reload} /> : !lv ? <Empty title={tx('tc.noSchedule')} /> : <div data-testid="pt-schedule-body">
          <dl className="fk-dl mo-dl"><dt>{tx('tc.f.shift')}</dt><dd>{lv.shift ? `${hm12(lv.shift.startTime)} – ${hm12(lv.shift.endTime)}` : tx('tc.noShiftToday')}{lv.shift?.breakStartTime ? ` · ${tx('tc.break')} ${hm12(lv.shift.breakStartTime)} – ${hm12(lv.shift.breakEndTime)}` : ''}</dd>
            <dt>{tx('tc.f.booked')}</dt><dd>{tx('tc.bookedV', { h: String(lv.bookedHours ?? 0), p: nf(lv.utilizationPercent) })}</dd></dl>
          {(lv.appointments ?? []).length === 0 && (lv.blocks ?? []).length === 0 ? <div className="fk-hint">{tx('tc.noneToday')}</div>
            : <ul className="fk-list dense">{[...(lv.appointments ?? []).map((a: any) => ({ k: 'a' + a.appointmentId, s: a.startTime, e: a.endTime, t: a.serviceSummary, sub: a.status })), ...(lv.blocks ?? []).map((b: any) => ({ k: 'b' + b.blockId, s: b.startTime, e: b.endTime, t: tx('tc.blocked'), sub: b.reason }))]
              .sort((a, b) => String(a.s).localeCompare(String(b.s))).map((i) => <li key={i.k} className="fk-li"><span className="fk-li-t">{hm12(i.s)} – {hm12(i.e)} · {i.t}<span className="fk-li-s">{i.sub}</span></span></li>)}</ul>}
          <div className="cg-acts"><button type="button" className="fk-btn" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(technicianId)}`)}>{tx('tc.openBooking')}</button></div>
        </div>) : null}
        {t === 'appointments' ? <>
          <div className="fk-seg" role="tablist">{(['upcoming', 'past'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={apScope === k} className={apScope === k ? 'on' : ''} onClick={() => { setApScope(k); setAp(1); }}>{tx('tc.appt.' + k)}</button>)}</div>
          {appts.error ? <StateBlock error={appts.error} onRetry={appts.reload} /> : !appts.data ? <div className="fk-loading">{tx('pos.loading')}</div> : appts.data.items.length === 0 ? <Empty title={tx('tc.noAppointments')} />
            : <><table className="fk-table fn-table cg-table" data-testid="pt-appointments-body"><thead><tr><th>{tx('tc.col.when')}</th><th>{tx('tc.col.services')}</th><th>{tx('tc.col.customer')}</th><th>{tx('pos.status')}</th></tr></thead>
              <tbody>{appts.data.items.map((a: any) => <tr key={a.appointmentId}><td>{a.date} · {hm12(a.start)}{a.minutes ? <span className="fk-li-s">{tx('cg.min', { n: nf(a.minutes) })}</span> : null}</td><td>{a.services.join(', ') || '—'}</td><td>{a.customer ?? '—'}</td><td>{codeLabel('tc.apptStatus.' + a.status, a.status)}</td></tr>)}</tbody></table>
              <Pager info={pageOf(appts.data)} onPage={setAp} /></>}
        </> : null}
        {t === 'performance' ? <div data-testid="pt-performance-body">
          <dl className="fk-dl mo-dl"><dt>{tx('tc.f.rating')}</dt><dd>{r ? ratingText(r.rating, r.ratingCount) : '—'}</dd><dt>{tx('tc.f.servicesToday')}</dt><dd>{nf(r?.servicesToday)}</dd></dl>
          {ratingList(ratings.data).length ? <ul className="fk-list dense">{ratingList(ratings.data).slice(0, 5).map((v, i: number) => <li key={v.ratingId ?? v.id ?? i} className="fk-li"><span className="fk-li-t">{'★'.repeat(Math.round(Number(v.rating ?? v.stars ?? 0)))}<span className="fk-li-s">{v.comment ?? ''}</span></span></li>)}</ul> : null}
          <h3 className="fk-h3">{tx('tc.serviceHistory')}</h3>
          {hist.error ? <StateBlock error={hist.error} onRetry={hist.reload} /> : !hist.data ? <div className="fk-loading">{tx('pos.loading')}</div> : hist.data.items.length === 0 ? <Empty title={tx('tc.noServicesMonth')} />
            : <><table className="fk-table fn-table cg-table"><thead><tr><th>{tx('tc.col.when')}</th><th>{tx('pos.service_3')}</th><th>{tx('tc.col.ticket')}</th><th className="num">{tx('tc.col.amount')}</th></tr></thead>
              <tbody>{hist.data.items.map((h: any) => <tr key={h.lineId}><td>{whenTime(h.at)}</td><td>{h.service}{h.addOn ? <span className="fk-li-s">{tx('cg.kind.add_on')}</span> : null}</td><td>{h.ticketNumber ? '#' + h.ticketNumber : '—'}</td><td className="num">{h.amountCents == null ? '—' : fmtMoney(h.amountCents)}</td></tr>)}</tbody></table>
              <Pager info={pageOf(hist.data)} onPage={setSp} /></>}
        </div> : null}
        {t === 'earnings' ? (d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <dl className="fk-dl mo-dl" data-testid="pt-earnings-body">
          <dt>{tx('tc.f.period')}</dt><dd>{x.payroll?.periodLabel ?? '—'}{x.payroll?.closed ? ` · ${tx('tc.finalised')}` : ` · ${tx('tc.estimated')}`}</dd>
          <dt>{tx('tc.f.sales')}</dt><dd>{fmtMoney(x.payroll?.salesCents ?? 0)}</dd>
          <dt>{tx('tc.f.commission')}</dt><dd>{fmtMoney(x.payroll?.commissionCents ?? 0)}</dd>
          <dt>{tx('tc.f.tips')}</dt><dd>{fmtMoney(x.payroll?.tipsCents ?? 0)}</dd>
          <dd className="fk-hint" style={{ gridColumn: '1 / -1' }}>{tx('tc.earningsRule')} <button type="button" className="fk-link" onClick={() => nav('/tenant/reports/commission')}>{tx('tc.openCommission')}</button></dd>
        </dl>) : null}
        {t === 'gallery' ? (prof.error ? <StateBlock error={prof.error} onRetry={prof.reload} /> : !pf ? <div className="fk-loading">{tx('pos.loading')}</div> : !pf.hasProfile ? <Empty title={tx('tc.noProfile')} />
          : (pf.photos ?? []).length === 0 ? <Empty title={tx('tc.noPhotos')} />
          : <div className="tc-gallery" data-testid="pt-gallery-body">{pf.photos.slice(0, 12).map((p: any) => <figure key={p.photoId}><img src={p.thumbnailUrl || p.imageUrl} alt={p.caption || ''} loading="lazy" /><figcaption>{p.caption || p.serviceCategory || ''}{p.hiddenHere ? ` · ${tx('tc.hiddenHere')}` : ''}</figcaption></figure>)}</div>) : null}
        {t === 'history' ? (events.error ? <StateBlock error={events.error} onRetry={events.reload} /> : !events.data ? <div className="fk-loading">{tx('pos.loading')}</div> : events.data.items.length === 0 ? <Empty title={tx('tc.noHistory')} />
          : <><HistoryTable rows={events.data.items} showTech={false} /><Pager info={pageOf(events.data)} onPage={setHp} /></>) : null}
      </>}
    </FitDialog>
  );
}

export function HistoryTable({ rows, showTech = true }: { rows: any[]; showTech?: boolean }) {
  return (
    <table className="fk-table fn-table cg-table" data-testid="history-table">
      <thead><tr><th>{tx('tc.col.when')}</th>{showTech ? <th>{tx('tc.col.technician')}</th> : null}<th>{tx('tc.col.event')}</th><th>{tx('tc.col.detail')}</th><th className="t-opt">{tx('tc.col.by')}</th></tr></thead>
      <tbody>{rows.map((h: any) => <tr key={h.source + h.id} data-testid="history-row"><td>{whenTime(h.at)}</td>{showTech ? <td>{h.technician ?? '—'}</td> : null}<td>{codeLabel('tc.event.' + h.kind.toLowerCase(), h.kind)}<span className="fk-li-s">{tx('tc.src.' + h.source)}</span></td><td className="cg-reason">{h.detail ?? '—'}</td><td className="t-opt">{h.actor ?? '—'}</td></tr>)}</tbody>
    </table>
  );
}

/** Find Qualified & Available Technician — the booking engine's openings for the chosen service(s) on a day. */
export function QualifiedFinder({ today, onClose }: { today: string; onClose: () => void }) {
  const nav = useNavigate();
  const [find, setFind] = useState(''); const fq = useDebounced(find.trim(), 250);
  const [picked, setPicked] = useState<{ serviceId: string; name: string; durationMinutes: number }[]>([]);
  const [date, setDate] = useState(today); const [offset, setOffset] = useState(0); const [why, setWhy] = useState(false);
  const svc = useLoad(() => posCatalogApi.services({ q: fq || undefined, status: 'active', sort: 'name', pageSize: 8 }), [fq]);
  const ids = picked.map((p) => p.serviceId);
  const res = useLoad(() => (ids.length ? posBookingApi.openings({ date, serviceIds: ids, limit: 10, offset }) : Promise.resolve(null)), [ids.join(','), date, offset]);
  useEffect(() => setOffset(0), [ids.join(','), date]);   // eslint-disable-line react-hooks/exhaustive-deps
  const r: any = res.data;
  return (
    <FitDialog wide title={tx('tc.finder')} subtitle={tx('tc.finderSub')} onClose={onClose} testId="dlg-finder" footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="cg-form">
        <label className="fk-field">{tx('tc.findService')}<input type="search" value={find} onChange={(e) => setFind(e.target.value)} data-testid="finder-search" /></label>
        <label className="fk-field">{tx('tc.date')}<input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value || today)} data-testid="finder-date" /></label>
      </div>
      <div className="cg-pick">{(svc.data?.items ?? []).map((s: any) => { const on = ids.includes(s.serviceId); return <button key={s.serviceId} type="button" className={'fk-btn sm ' + (on ? 'primary' : 'ghost')} aria-pressed={on} data-testid="finder-pick"
        onClick={() => setPicked((x) => on ? x.filter((p) => p.serviceId !== s.serviceId) : [...x, { serviceId: s.serviceId, name: s.name, durationMinutes: s.durationMinutes }])}>{on ? '✓ ' : '+ '}{s.name} · {tx('cg.min', { n: nf(s.durationMinutes) })}</button>; })}</div>
      {!ids.length ? <div className="fk-hint">{tx('tc.finderPick')}</div> : res.error ? <StateBlock error={res.error} onRetry={res.reload} /> : !r ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-note ok" data-testid="finder-summary"><span>{tx('tc.finderSummary', { d: nf(r.durationMinutes), e: nf(r.eligibleCount), w: nf(r.withOpenings) })}</span></div>
        {r.openings.length === 0 ? <Empty title={tx('tc.finderNone')}><button type="button" className="fk-btn" onClick={() => { const n = new Date(date + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1); setDate(n.toISOString().slice(0, 10)); }} data-testid="finder-next-day">{tx('tc.tryNextDay')}</button></Empty>
          : <table className="fk-table fn-table cg-table" data-testid="finder-table"><thead><tr><th>#</th><th>{tx('tc.col.technician')}</th><th>{tx('tc.col.earliest')}</th><th>{tx('tc.col.ends')}</th><th className="num">{tx('tc.col.openings')}</th>{r.openings.some((o: any) => o.branch !== undefined) ? <th>{tx('tc.col.branch')}</th> : null}<th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{r.openings.map((o: any) => <tr key={o.technicianId} data-testid="finder-row"><td>{o.rank}</td><td>{o.name}</td><td><b>{hm12(o.time)}</b></td><td>{hm12(addMin(o.time, r.durationMinutes))}</td><td className="num">{nf(o.openSlots)}</td>{o.branch !== undefined ? <td data-testid="finder-branch">{o.branch ? (o.branch.branchId ? o.branch.name ?? '—' : tx('tc.branch.salonWide')) : '—'}</td> : null}
              <td className="fn-acts"><button type="button" className="fk-btn sm primary" data-testid="finder-select" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(o.technicianId)}&date=${date}&time=${encodeURIComponent(o.time)}&serviceId=${encodeURIComponent(ids[0])}`)}>{tx('tc.select')}</button></td></tr>)}</tbody></table>}
        {r.hasMore ? <button type="button" className="fk-btn ghost" onClick={() => setOffset(offset + 10)}>{tx('tc.more')}</button> : null}
        <div className="fk-hint">{tx('tc.finderRule')}</div>
        {/* round 10 (LIVE TECHNICIAN SCHEDULE 05) — Multi-Tech Conflict View: with two or more services, preview the start times
            when a DIFFERENT qualified technician is free for EACH service at the same time (the engine's own availability per
            service, combined here; nothing is held or booked) */}
        {picked.length >= 2 ? <MultiTechSync date={date} services={picked} /> : null}
        {/* Extras (Live Technician Schedule row 10): why is a technician NOT listed? The same read-only check the conflict
            warning uses — it cites the technician's actual service mapping (technician_services) by service name, plus
            shift / break / time off / booked time for the chosen start. Nothing is saved or booked. */}
        <button type="button" className="fk-link" aria-expanded={why} onClick={() => setWhy((v) => !v)} data-testid="finder-why-toggle">{tx('tc.finderWhy')}</button>
        {why ? <ConflictPanel key={ids.join(',') + '|' + date} today={today} testId="finder-why"
          initial={{ date, serviceIds: ids, minutes: r.durationMinutes || picked.reduce((a, p) => a + (Number(p.durationMinutes) || 0), 0) || 45, start: r.openings[0]?.time ?? undefined }} /> : null}
      </>}
    </FitDialog>
  );
}

/** round 10 (LIVE TECHNICIAN SCHEDULE 05): start times when every picked service has its OWN free qualified technician at once.
 *  Each service's availability comes from the booking engine (qualification, shift, breaks, holds, buffer — its rules, not
 *  ours); this only finds the shared start times and gives each service a different technician (first free one in roster order). */
export function syncStarts(per: Array<Array<{ technicianId: string; name: string; slots: string[] }>>, max = 10): Array<{ time: string; techs: Array<{ technicianId: string; name: string }> }> {
  const times = [...new Set(per.flatMap((techs) => techs.flatMap((t) => t.slots)))].sort();
  const out: Array<{ time: string; techs: Array<{ technicianId: string; name: string }> }> = [];
  for (const time of times) {
    const free = per.map((techs) => techs.filter((t) => t.slots.includes(time)));
    if (free.some((f) => !f.length)) continue;
    // assign distinct technicians — the service with the fewest choices first (small sets: a few services, a page of technicians)
    const order = free.map((f, i) => i).sort((a, b) => free[a].length - free[b].length);
    const used = new Set<string>(); const pick: Array<{ technicianId: string; name: string } | null> = free.map(() => null);
    const place = (k: number): boolean => { if (k === order.length) return true; const i = order[k];
      for (const t of free[i]) { if (used.has(t.technicianId)) continue; used.add(t.technicianId); pick[i] = { technicianId: t.technicianId, name: t.name }; if (place(k + 1)) return true; used.delete(t.technicianId); }
      return false; };
    if (place(0)) out.push({ time, techs: pick as Array<{ technicianId: string; name: string }> });
    if (out.length >= max) break;
  }
  return out;
}
function MultiTechSync({ date, services }: { date: string; services: { serviceId: string; name: string; durationMinutes: number }[] }) {
  const key = services.map((x) => x.serviceId).join(',');
  const av = useLoad(() => Promise.all(services.map((x) => posBookingApi.availability({ date, serviceIds: [x.serviceId] }))), [key, date]);
  const per = (av.data ?? []).map((r: any) => (Array.isArray(r) ? r : []).map((t: any) => ({ technicianId: String(t.technicianId), name: String(t.name ?? ''), slots: Array.isArray(t.slots) ? t.slots.map(String) : [] })));
  const rows = av.data ? syncStarts(per) : [];
  return <section data-testid="finder-sync">
    <h3 className="fk-h3">{tx('tc.sync.title')}</h3>
    <p className="fk-hint">{tx('tc.sync.sub', { n: nf(services.length) })}</p>
    {av.error ? <StateBlock error={av.error} onRetry={av.reload} /> : !av.data ? <div className="fk-loading">{tx('pos.loading')}</div>
      : !rows.length ? <div className="fk-hint" data-testid="finder-sync-none">{tx('tc.sync.none')}</div>
      : <table className="fk-table fn-table cg-table"><thead><tr><th>{tx('tc.col.earliest')}</th>{services.map((x) => <th key={x.serviceId}>{x.name}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.time} data-testid="finder-sync-row"><td><b>{hm12(r.time)}</b></td>{r.techs.map((t, i) => <td key={services[i].serviceId}>{t.name}</td>)}</tr>)}</tbody></table>}
  </section>;
}

/** Service Mapping Assistant — never qualifies everyone; a manager ticks genuine qualifications and saves one technician. */
export function MappingAssistant({ initialTechnicianId, onClose, onSaved }: { initialTechnicianId?: string | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [tid, setTid] = useState<string | null>(initialTechnicianId ?? null); const [lp, setLp] = useState(1);
  const list = useLoad(() => posTechniciansScreenApi.directory({ missingMapping: '1', sort: 'name', page: lp, pageSize: 8 }), [lp]);
  const rev = useLoad(() => (tid ? posTechniciansScreenApi.mapping(tid) : Promise.resolve(null)), [tid]);
  const [want, setWant] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [find, setFind] = useState('');
  useEffect(() => { if (rev.data) setWant(new Set(rev.data.services.filter((s: any) => s.mapped).map((s: any) => s.serviceId))); }, [rev.data]);
  const before = useMemo(() => new Set<string>((rev.data?.services ?? []).filter((s: any) => s.mapped).map((s: any) => s.serviceId)), [rev.data]);
  const added = [...want].filter((x) => !before.has(x)); const removed = [...before].filter((x) => !want.has(x));
  const who = useLoad(() => (tid ? posTechniciansScreenApi.directory({ q: tid, status: 'all', pageSize: 1 }) : Promise.resolve(null)), [tid]);
  const name = who.data?.items?.[0]?.name;
  const save = async () => {
    if (!tid) return; setBusy(true); setErr(null);
    try { await posTechniciansApi.setServices(tid, { serviceIds: [...want] }); onSaved(tx('tc.mapSaved', { a: nf(added.length), r: nf(removed.length) })); }
    catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  const services = (rev.data?.services ?? []).filter((s: any) => !find.trim() || s.name.toLowerCase().includes(find.trim().toLowerCase()) || String(s.category ?? '').toLowerCase().includes(find.trim().toLowerCase()));
  return (
    <FitDialog wide title={tx('tc.mapping')} subtitle={tx('tc.mappingSub')} onClose={onClose} busy={busy} testId="dlg-mapping"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>{tid ? <button type="button" className="fk-btn primary" onClick={save} disabled={busy || (!added.length && !removed.length)} data-testid="mapping-save">{tx('tc.mapSave', { a: nf(added.length), r: nf(removed.length) })}</button> : null}</>}>
      {!tid ? (list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div> : list.data.items.length === 0 ? <Empty title={tx('tc.allMapped')} />
        : <><div className="fk-hint">{tx('tc.unmappedN', { n: nf(list.data.totalItems) })}</div>
          <ul className="fk-list dense" data-testid="mapping-list">{list.data.items.map((x: any) => <li key={x.technicianId} className="fk-li"><span className="fk-li-t">{x.name}<span className="fk-li-s">{roleText(x.role)} · {tx('tc.noMappingReason')}</span></span>
            <button type="button" className="fk-btn sm" onClick={() => setTid(x.technicianId)} data-testid="mapping-open">{tx('tc.review')}</button></li>)}</ul><Pager info={pageOf(list.data)} onPage={setLp} /></>)
      : rev.error ? <StateBlock error={rev.error} onRetry={rev.reload} /> : !rev.data ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="cg-dhead"><b className="cg-dname">{name ?? ''}</b><button type="button" className="fk-link" onClick={() => setTid(null)}>{tx('tc.backToList')}</button></div>
        <label className="fk-field wide">{tx('tc.findService')}<input type="search" value={find} onChange={(e) => setFind(e.target.value)} /></label>
        <table className="fk-table fn-table cg-table" data-testid="mapping-table"><thead><tr><th aria-label={tx('tc.qualified')} /><th>{tx('pos.service_3')}</th><th>{tx('pos.category')}</th><th className="num">{tx('pos.duration')}</th><th>{tx('tc.col.evidence')}</th></tr></thead>
          <tbody>{services.map((s: any) => <tr key={s.serviceId} data-testid="mapping-row"><td><input type="checkbox" aria-label={s.name} checked={want.has(s.serviceId)} onChange={(e) => setWant((w) => { const n = new Set(w); if (e.target.checked) n.add(s.serviceId); else n.delete(s.serviceId); return n; })} data-testid="mapping-check" /></td>
            <td>{s.name}{!s.active ? <span className="fk-li-s">{tx('cg.status.inactive')}</span> : null}</td><td>{s.category ?? '—'}</td><td className="num">{tx('cg.min', { n: nf(s.durationMinutes) })}</td>
            <td>{s.requested ? <span className="fk-chip info">{tx('tc.requested')}</span> : null}{s.performedBefore ? <span className="fk-li-s">{tx('tc.performedN', { n: nf(s.performedBefore) })}</span> : null}</td></tr>)}</tbody></table>
        <div className="fk-hint">{tx('tc.mappingRule')}</div>
        {err ? <div className="fk-note bad" role="alert"><span>{err}</span></div> : null}
      </>}
    </FitDialog>
  );
}
