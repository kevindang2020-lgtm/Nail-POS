// WalkInPicker.tsx — CPad 14 Walk-In service selection screens (SUNMI guide Section 4A, the 1920×1200 landscape concept):
//
//   Choose Your Services   the salon's category tiles (from ITS catalog — never a fixed list), a full-width search, Back,
//                          "Selected: N services" and "Review My Services" pinned at the bottom
//   a category             its services: name, description, public price ("From $X" only for a variable price), estimated
//                          time, Add / Added, and the add-ons a picked service may carry; the list scrolls inside itself
//   Review                 the SERVER's re-priced lines, add-ons, "Estimated service total" (final at checkout), a short
//                          note, an optional technician REQUEST, Edit / Back / Cancel / Confirm Check-In
//
// It covers the whole display while open (the promotions are gone during input — 4A / §3) and holds no state of its own
// beyond the cancel question: everything is useWalkInSelection's. Feature-scoped styles (.wis-*); nothing global.
import { useState } from 'react';
import type { CustomerDisplayBranding, WalkInServiceOption } from '@aipowersalon/api-contracts/customer';
import type { CheckInFlow } from './useCheckInFlow';
import { pickState, searchServices } from './useWalkInSelection';
import { SalonBrand } from './Branding';
import { useT } from './i18n';

/** Whole dollars stay whole ("$45"); cents are shown when there are any ("$12.50"). */
export function money(cents: number): string {
  const whole = cents % 100 === 0;
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

function Price({ cents, from }: { cents: number | null; from?: boolean }) {
  const t = useT();
  if (cents === null) return null;
  return <span className="wis-price">{from ? t('wis.from', { price: money(cents) }) : money(cents)}</span>;
}
function Minutes({ m }: { m: number | null }) {
  const t = useT();
  return m ? <span className="wis-min">{t('wis.minutes', { n: m })}</span> : null;
}

function ServiceRow({ f, s }: { f: CheckInFlow; s: WalkInServiceOption }) {
  const t = useT();
  const ws = f.ws;
  const pick = ws.picks.find((p) => p.serviceId === s.id);
  const addOns = (ws.catalog?.addOns ?? []).filter((a) => s.addOnIds.includes(a.id));
  return (
    <li className={`wis-svc${pick ? ' on' : ''}`} data-testid={`wis-svc-${s.id}`}>
      <div className="wis-svc-main">
        <div className="wis-svc-text">
          <div className="wis-svc-name serif">{s.name}</div>
          {s.description ? <div className="wis-svc-desc">{s.description}</div> : null}
          <div className="wis-svc-meta"><Price cents={s.priceCents} from={s.priceIsFrom} /><Minutes m={s.durationMinutes} /></div>
        </div>
        <button type="button" className={`wis-add${pick ? ' on' : ''}`} aria-pressed={!!pick} onClick={() => ws.toggleService(s)}
          aria-label={pick ? t('wis.removeAria', { name: s.name }) : t('wis.addAria', { name: s.name })}>{pick ? t('wis.added') : t('wis.add')}</button>
      </div>
      {pick && addOns.length ? (
        <div className="wis-addons" role="group" aria-label={t('wis.addOnsFor', { name: s.name })}>
          <span className="wis-addons-l">{t('wis.addOns')}</span>
          {addOns.map((a) => {
            const on = pick.addOnIds.includes(a.id);
            return (
              <button key={a.id} type="button" className={`wis-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => ws.toggleAddOn(s.id, a.id)}>
                <span>{a.name}</span>{a.priceCents !== null ? <span className="p">+{money(a.priceCents)}</span> : null}{a.durationMinutes ? <span className="m">+{t('wis.minutes', { n: a.durationMinutes })}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </li>
  );
}

function Browse({ f }: { f: CheckInFlow }) {
  const t = useT();
  const ws = f.ws;
  const cat = ws.catalog;
  const results = searchServices(cat, ws.query);
  return (
    <div className="wis-body">
      <div className="wis-title serif">{t('wis.choose')}</div>
      <div className="wis-sub">{t('wis.chooseSub')}</div>
      <label className="wis-search">
        <span className="ico" aria-hidden="true">⌕</span>
        <input type="search" value={ws.query} onChange={(e) => ws.setQuery(e.target.value)} placeholder={t('wis.searchPh')} aria-label={t('wis.searchPh')} autoComplete="off" enterKeyHint="search" />
        {ws.query ? <button type="button" className="wis-search-x" onClick={() => ws.setQuery('')} aria-label={t('wis.clearSearch')}>✕</button> : null}
      </label>
      <div className="wis-scroll">
        {ws.query ? (
          results.length ? <ul className="wis-list">{results.map((s) => <ServiceRow key={s.id} f={f} s={s} />)}</ul>
            : <div className="wis-empty">{t('wis.noResults')}</div>
        ) : cat && cat.categories.length ? (
          <div className="wis-tiles">
            {cat.categories.map((c) => {
              const n = ws.picks.filter((p) => cat.services.some((s) => s.id === p.serviceId && s.categoryId === c.id)).length;
              return (
                <button key={c.id} type="button" className={`wis-tile${n ? ' on' : ''}`} onClick={() => ws.setView({ kind: 'category', categoryId: c.id })} data-testid={`wis-cat-${c.id}`}>
                  <span className="n serif">{c.name}</span>
                  <span className="c">{n ? t('wis.selectedIn', { n }) : t(c.serviceCount === 1 ? 'wis.oneService' : 'wis.nServices', { n: c.serviceCount })}</span>
                </button>
              );
            })}
          </div>
        ) : <div className="wis-empty">{t('wis.noCategories')}</div>}
      </div>
    </div>
  );
}

function Category({ f, categoryId }: { f: CheckInFlow; categoryId: string }) {
  const t = useT();
  const ws = f.ws;
  const c = ws.catalog?.categories.find((x) => x.id === categoryId);
  const services = (ws.catalog?.services ?? []).filter((s) => s.categoryId === categoryId);
  return (
    <div className="wis-body">
      <div className="wis-cat-head">
        <button type="button" className="wis-back" onClick={() => ws.setView({ kind: 'browse' })}>‹ {t('wis.back')}</button>
        <div>
          <div className="wis-title serif">{c?.name ?? t('wis.unavailableCategory')}</div>
          {c?.description ? <div className="wis-sub">{c.description}</div> : null}
        </div>
      </div>
      <div className="wis-scroll">
        {services.length ? <ul className="wis-list">{services.map((s) => <ServiceRow key={s.id} f={f} s={s} />)}</ul> : <div className="wis-empty">{t('wis.unavailableCategory')}</div>}
      </div>
    </div>
  );
}

function Review({ f }: { f: CheckInFlow }) {
  const t = useT();
  const ws = f.ws;
  const pv = ws.preview;
  const rules = ws.catalog?.rules;
  return (
    <div className="wis-body">
      <div className="wis-cat-head">
        <button type="button" className="wis-back" onClick={() => ws.setView({ kind: 'browse' })}>‹ {t('wis.back')}</button>
        <div className="wis-title serif">{t('wis.reviewTitle')}</div>
      </div>
      <div className="wis-scroll">
        {ws.changedNotice ? <div className="wis-banner" role="alert">{t('wis.changedBanner')}</div> : null}
        {ws.skip && !ws.picks.length ? <div className="wis-pending" data-testid="wis-pending">{t('wis.pendingNote')}</div> : null}
        {!pv && ws.previewing ? <div className="wis-empty">{t('wis.checking')}</div> : null}
        {pv ? (
          <ul className="wis-review">
            {pv.lines.map((l) => (
              <li key={l.serviceId} className={`wis-rline ${l.state}`} data-testid={`wis-line-${l.serviceId}`}>
                <div className="wis-rline-top">
                  <span className="n serif">{l.name || t('wis.unavailableService')}</span>
                  {l.state === 'changed' ? <span className="wis-badge chg">{t('wis.changed')}</span> : null}
                  {l.state === 'unavailable' ? <span className="wis-badge na">{t('wis.noLongerAvailable')}</span> : null}
                  <span className="r"><Price cents={l.priceCents} /><Minutes m={l.durationMinutes} /></span>
                  {l.state === 'unavailable' ? <button type="button" className="wis-remove" onClick={() => ws.remove(l.serviceId)}>{t('wis.remove')}</button> : null}
                </div>
                {l.addOns.length ? (
                  <ul className="wis-raddons">
                    {l.addOns.map((a) => (
                      <li key={a.id} className={a.state}>
                        <span>+ {a.name || t('wis.unavailableService')}</span>
                        {a.state === 'unavailable' ? <span className="wis-badge na">{t('wis.noLongerAvailable')}</span> : <span className="r">{a.priceCents !== null ? `+${money(a.priceCents)}` : ''}{a.durationMinutes ? ` · +${t('wis.minutes', { n: a.durationMinutes })}` : ''}</span>}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {pv && pv.lines.length ? (
          <div className="wis-total" data-testid="wis-total">
            {pv.estimatedTotalCents !== null ? <div className="row"><span>{t('wis.estimatedTotal')}</span><b className="serif">{money(pv.estimatedTotalCents)}</b></div> : null}
            {pv.estimatedMinutes ? <div className="row"><span>{t('wis.estimatedTime')}</span><b>{t('wis.minutes', { n: pv.estimatedMinutes })}</b></div> : null}
            <div className="wis-fine">{t('wis.finalAtCheckout')}</div>
          </div>
        ) : null}
        <label className="wis-notes">
          <span>{t('wis.notes')}</span>
          <textarea value={ws.notes} maxLength={rules?.notesMaxLength ?? 200} rows={2} onChange={(e) => ws.setNotes(e.target.value)} placeholder={t('wis.notesPh')} />
          <span className="wis-count">{ws.notes.length}/{rules?.notesMaxLength ?? 200}</span>
        </label>
        {rules?.allowTechnicianPreference && ws.techs.length ? (
          <label className="wis-notes">
            <span>{t('wis.techPref')}</span>
            <select value={ws.techId} onChange={(e) => ws.setTechId(e.target.value)}>
              <option value="">{t('wis.noPreference')}</option>
              {ws.techs.map((x) => <option key={x.technicianId} value={x.technicianId}>{x.fromLabel ? `${x.name} · ${x.fromLabel}` : x.name}</option>)}
            </select>
            <span className="wis-fine">{t('wis.techRequestNote')}</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}

export function WalkInPicker({ f, branding, salonName, inMain = false }: { f: CheckInFlow; branding?: CustomerDisplayBranding; salonName: string; /** a checkout is on the right: cover the check-in side only */ inMain?: boolean }) {
  const t = useT();
  const ws = f.ws;
  const [asking, setAsking] = useState(false);
  if (!ws.open) return null;
  const n = ws.picks.length;
  const stale = ws.picks.filter((p) => pickState(p, ws.catalog) === 'unavailable').length;
  const review = ws.view.kind === 'review';
  return (
    <div className={`wis${inMain ? ' in-main' : ''}`} role="dialog" aria-modal="true" aria-label={t('wis.choose')} data-testid="walkin-picker">
      <header className="wis-head">
        <SalonBrand branding={branding} salonName={salonName} />
        <div className="wis-head-r">
          <span className="wis-crumb">{t('wis.crumb')}</span>
          <button type="button" className="wis-cancel" onClick={() => setAsking(true)}>{t('wis.cancel')}</button>
        </div>
      </header>
      {ws.view.kind === 'browse' ? <Browse f={f} /> : ws.view.kind === 'category' ? <Category f={f} categoryId={ws.view.categoryId} /> : <Review f={f} />}
      <footer className="wis-foot">
        <div className="wis-count-l">
          <b>{t(n === 1 ? 'wis.selectedOne' : 'wis.selectedN', { n })}</b>
          {stale ? <span className="wis-stale">{t('wis.staleN', { n: stale })}</span> : null}
          {ws.err ? <span className="wis-err" role="alert" onClick={() => ws.setErr(null)}>{t(ws.err)}</span> : null}
        </div>
        <div className="wis-foot-r">
          {!review && ws.canSkip && !n ? (
            <button type="button" className="wis-ghost" onClick={() => { ws.setSkip(true); ws.setView({ kind: 'review' }); }}>{t('wis.skip')}</button>
          ) : null}
          {review ? (
            <>
              <button type="button" className="wis-ghost" onClick={() => ws.setView({ kind: 'browse' })}>{t('wis.edit')}</button>
              <button type="button" className="wis-primary" disabled={!ws.canConfirm} onClick={() => { void f.confirmSelection(); }} data-testid="wis-confirm">
                {ws.confirming ? t('wis.confirming') : ws.changedNotice ? t('wis.confirmUpdated') : t('wis.confirm')}
              </button>
            </>
          ) : (
            <button type="button" className="wis-primary" disabled={!n && ws.servicesRequired} onClick={() => ws.setView({ kind: 'review' })} data-testid="wis-review">{t('wis.review')}</button>
          )}
        </div>
      </footer>
      {asking ? (
        <div className="wis-ask" role="alertdialog" aria-label={t('wis.cancelQ')}>
          <div className="wis-ask-card">
            <div className="wis-title serif">{t('wis.cancelQ')}</div>
            <div className="wis-sub">{t('wis.cancelS')}</div>
            <div className="wis-ask-row">
              <button type="button" className="wis-ghost" onClick={() => setAsking(false)}>{t('wis.keepGoing')}</button>
              <button type="button" className="wis-primary" onClick={() => { setAsking(false); f.reset(); }} data-testid="wis-cancel-yes">{t('wis.cancelYes')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
