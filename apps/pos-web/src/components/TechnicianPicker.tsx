// TechnicianPicker.tsx — 200-technician mandate (Oct 23 2026): Add Walk-In and New Booking listed EVERY technician as a
// button (200 buttons in a 180px box, a 200-chip horizontal scroller) and never narrowed them to who can do the chosen
// services. This picker asks the server (GET /pos/booking/technicians) for ONE page at a time: search by name, phone or
// "#roster", only technicians approved for EVERY chosen service (the one eligibility authority — hard eligibility first),
// optionally only those working that day. 12 a page; Prev / Next walk the rest.
import React, { useEffect, useRef, useState } from 'react';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import type { BookingTechnicianPage, BookingTechnicianSummary } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from './ImeSafeInput';
import { posBookingApi } from '../api/posBookingApi';

export const TECH_PICKER_PAGE_SIZE = 12;

export interface TechnicianPickerProps {
  value: string;
  onChange: (technicianId: string, tech?: BookingTechnicianSummary) => void;
  /** YYYY-MM-DD the visit is for (working-today and eligibility are judged for that day) */
  date?: string;
  /** the chosen services: only technicians approved for every one of them are offered */
  serviceIds?: string[];
  /** the selected technician's name when it is known from elsewhere (it may not be on the page on screen) */
  selectedName?: string;
  /** start with "working that day only" ticked (default true) */
  workingOnlyDefault?: boolean;
  /** shown as a first choice when given ("First available") — picking it sends '' */
  anyLabel?: string;
  /** test hook: debounce for the search box (ms) */
  debounceMs?: number;
}

export function TechnicianPicker({ value, onChange, date, serviceIds, selectedName, workingOnlyDefault = true, anyLabel, debounceMs = 200 }: TechnicianPickerProps) {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [workingOnly, setWorkingOnly] = useState(workingOnlyDefault);
  // round 10 (AI Scheduling Optimizer 10): a skill (service category) filter — the booking engine's own `skill` filter; the
  // choices are the skills the server has shown on technicians so far (no list is invented)
  const [skill, setSkill] = useState(''); const [skillsSeen, setSkillsSeen] = useState<string[]>([]);
  const [data, setData] = useState<BookingTechnicianPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<BookingTechnicianSummary | null>(null);
  const seq = useRef(0);
  const svcKey = (serviceIds || []).filter(Boolean).join(',');

  // only a CHANGED search goes back to page 1 (the first debounce after mount used to reset a page the user had already moved to)
  const qNow = useRef('');
  useEffect(() => { const h = setTimeout(() => { const v = search.trim(); if (v === qNow.current) return; qNow.current = v; setQ(v); setPage(1); }, debounceMs); return () => clearTimeout(h); }, [search, debounceMs]);
  useEffect(() => { setPage(1); }, [svcKey, date, workingOnly, skill]);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    posBookingApi.technicians({ date, page, pageSize: TECH_PICKER_PAGE_SIZE, search: q || undefined, serviceIds: svcKey ? svcKey.split(',') : undefined, working: workingOnly || undefined, skill: skill || undefined })
      .then((r) => {
        if (n !== seq.current) return;
        if (!r || !Array.isArray(r.technicians)) { setData(null); setError(tx('pos.could_not_load_technicians')); return; }
        setData(r); setError(null);
        const seen = r.technicians.flatMap((x) => (Array.isArray(x.skills) ? x.skills : []));
        if (seen.length) setSkillsSeen((prev) => { const all = [...new Set([...prev, ...seen])].sort((a, b) => a.localeCompare(b)); return all.length === prev.length ? prev : all; });
      })
      .catch((e: any) => { if (n === seq.current) { setData(null); setError(e?.message || tx('pos.could_not_load_technicians')); } })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [date, page, q, svcKey, workingOnly, skill]);

  // A chosen technician who cannot do the NEW set of services is not silently kept: ask the server whether the selection
  // is still in the eligible set (locate) and clear it with a note when it is not.
  const [dropped, setDropped] = useState<string | null>(null);
  const valueRef = useRef(value); valueRef.current = value;
  useEffect(() => {
    const id = valueRef.current; setDropped(null);
    if (!id || !svcKey) return;
    let live = true;
    posBookingApi.technicians({ date, serviceIds: svcKey.split(','), locate: id, pageSize: TECH_PICKER_PAGE_SIZE })
      .then((r) => { if (live && r && Array.isArray(r.technicians) && r.located === null && valueRef.current === id) { setDropped(id); onChange(''); } })
      .catch(() => { /* the create call re-checks eligibility on the server; a failed pre-check keeps the choice */ });
    return () => { live = false; };
  }, [svcKey, date]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onPage = data?.technicians.find((t) => t.technicianId === value);
  const shownName = onPage?.name ?? (picked?.technicianId === value ? picked.name : undefined) ?? selectedName;
  const pages = data?.totalPages ?? 1;
  const pick = (t: BookingTechnicianSummary) => { setPicked(t); onChange(t.technicianId, t); };

  return (
    <div data-testid="technician-picker" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ImeSafeInput type="search" aria-label={tx('pos.find_technician')} placeholder={tx('pos.find_technician_placeholder')} value={search}
          onValue={setSearch}
          style={{ flex: '1 1 180px', minWidth: 0, height: 36, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', font: 'inherit', fontSize: 13 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={workingOnly} onChange={(e) => setWorkingOnly(e.target.checked)} /> {tx('pos.working_that_day_only')}
        </label>
        {skillsSeen.length ? <select aria-label={tx('tpk.skill')} value={skill} onChange={(e) => setSkill(e.target.value)} data-testid="tech-picker-skill" style={{ height: 36, border: '1px solid var(--line)', borderRadius: 8, font: 'inherit', fontSize: 12.5 }}>
          <option value="">{tx('tpk.allSkills')}</option>{skillsSeen.map((k) => <option key={k} value={k}>{k}</option>)}</select> : null}
      </div>
      {dropped ? <div role="status" style={{ fontSize: 12, color: '#B54708' }}>{tx('pos.technician_not_eligible_cleared')}</div> : null}
      {value && shownName ? <div className="s" style={{ fontSize: 12 }}>{tx('pos.selected_technician_x', { name: shownName })}</div> : null}
      <div role="listbox" aria-label={tx('pos.technician')} style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
        {anyLabel ? (
          <button type="button" role="option" aria-selected={value === ''} onClick={() => { setPicked(null); onChange(''); }}
            style={rowStyle(value === '')}><span style={{ fontWeight: 600, fontSize: 14 }}>{anyLabel}</span></button>
        ) : null}
        {error ? <div role="alert" style={{ fontSize: 12.5, color: '#B42318' }}>{error}</div> : null}
        {!error && data && data.technicians.length === 0 ? (
          <div className="s" style={{ fontSize: 12.5 }}>{svcKey ? tx('pos.no_technician_for_these_services') : tx('pos.no_technician_matches')}</div>
        ) : null}
        {(data?.technicians ?? []).map((t) => (
          <button key={t.technicianId} type="button" role="option" aria-selected={value === t.technicianId} onClick={() => pick(t)} style={rowStyle(value === t.technicianId)}>
            <ProfileAvatarWithPreview url={t.avatarUrl ?? undefined} name={t.name} size={30} style={{ border: '1px solid var(--line)', pointerEvents: 'none' }} />
            <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            {t.rosterNumber != null ? <span className="s" style={{ fontSize: 11.5 }}>#{t.rosterNumber}</span> : null}
            <span className="s" style={{ fontSize: 11.5 }}>{t.workingToday ? tx('pos.working_today_label') : tx('pos.off_today')}</span>
          </button>
        ))}
      </div>
      {data ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span className="s">{svcKey ? tx('pos.n_eligible_technicians', { n: String(data.total) }) : tx('pos.n_technicians', { n: String(data.total) })}</span>
          {loading ? <span className="s">…</span> : null}
          {pages > 1 ? (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{tx('pos.previous')}</button>
              <span>{tx('pos.page_x_of_y', { page: String(data.page), pages: String(pages) })}</span>
              <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>{tx('pos.next')}</button>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function rowStyle(selected: boolean): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 8, border: selected ? '2px solid var(--aps-orange)' : '1px solid var(--line)', background: selected ? '#FFF8F2' : '#FFF', cursor: 'pointer', textAlign: 'left', font: 'inherit' };
}
