// catalogShared.tsx — pieces shared by the four rebuilt catalog screens (Oct 30 2026): Services & Products, Service
// Categories, Service Pricing and Add-Ons. Formatting, the simple honest charts, the customer-history table, the Edit
// Pricing dialog and the Edit Service dialog. Every number comes from `/pos/catalog/*` (or the module it names).
import { useEffect, useState, type ReactNode } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { posServicesApi } from '../api/posServicesApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, type PageInfo } from '../components/FitKit';
import { centsFromText, textFromCents } from '../components/FinanceKit';

export const nf = (n: number | null | undefined) => fmtNumber(n || 0);
export const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
export const mins = (m: number | null | undefined) => (m ? tx('cg.min', { n: nf(m) }) : '—');
export const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
export const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
export const pageOf = (d: any): PageInfo | null => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages } : null);
/** the inventory module pages as { total, page, pageSize, pages } */
export const invPageOf = (d: any): PageInfo | null => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pages } : null);
export const STATUS_TONE: Record<string, string> = { active: 'ok', inactive: 'warn', archived: 'mut' };
export const statusText = (s: string) => tx('cg.status.' + (['active', 'inactive', 'archived'].includes(s) ? s : 'active'));
/** a value from the change log, shown in the unit of its field */
export const changeValue = (field: string, v: string | null) => {
  if (v == null || v === '') return '—';
  if (field.endsWith('cents')) return fmtMoney(Number(v));
  if (field.includes('minutes')) return mins(Number(v));
  if (v === 'true') return tx('pos.yes'); if (v === 'false') return tx('pos.no');
  return v;
};
export const fieldText = (f: string) => {
  const k = 'cg.field.' + f; const s = tx(k); return s === k ? f : s;
};
export const saveCsv = (name: string, text: string) => { const blob = new Blob([String(text)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

const PALETTE = ['#A96F22', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8', '#C89B5A', '#8C8C8C'];
type Mix = { label: string; cents: number; count?: number };
/** a donut of realized revenue shares (cents), the rest folded into "Other" */
export function Donut({ items, testId, empty }: { items: Mix[]; testId: string; empty: string }) {
  const top = items.slice(0, 5); const rest = items.slice(5).reduce((a, x) => a + x.cents, 0);
  const all = rest > 0 ? [...top, { label: tx('cg.other'), cents: rest }] : top;
  const total = all.reduce((a, x) => a + x.cents, 0);
  if (total <= 0) return <div className="fk-hint cg-chart-empty" data-testid={testId + '-empty'}>{empty}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div className="cg-donut" data-testid={testId} role="img" aria-label={all.map((x) => `${x.label} ${fmtMoney(x.cents)}`).join(', ')}>
      <svg viewBox="0 0 140 140" aria-hidden="true">
        {all.map((it, i) => { const dash = (it.cents / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <ul>{all.map((it, i) => <li key={i}><span className="cg-sw" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="cg-dn">{it.label}</span><b>{Math.round((it.cents / total) * 100)}%</b><span className="fk-muted">{fmtMoney(it.cents)}</span></li>)}</ul>
    </div>
  );
}
/** horizontal bars (counts or cents) */
export function Bars({ items, testId, empty, fmt }: { items: { name: string; value: number; sub?: string }[]; testId: string; empty: string; fmt: (n: number) => string }) {
  const max = Math.max(0, ...items.map((x) => x.value));
  if (!items.length || max <= 0) return <div className="fk-hint cg-chart-empty" data-testid={testId + '-empty'}>{empty}</div>;
  return (
    <ul className="cg-bars" data-testid={testId}>
      {items.map((x, i) => <li key={i} title={`${x.name}: ${fmt(x.value)}`}><span className="cg-bn">{x.name}</span><span className="cg-bt"><span style={{ width: `${Math.max(2, (x.value / max) * 100)}%` }} /></span><b>{fmt(x.value)}</b>{x.sub ? <span className="fk-muted cg-bs">{x.sub}</span> : null}</li>)}
    </ul>
  );
}
export function Gauge({ pct, testId, children }: { pct: number | null; testId: string; children?: ReactNode }) {
  const R = 46, C = 2 * Math.PI * R; const v = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="cg-gauge" data-testid={testId}>
      <svg viewBox="0 0 120 120" role="img" aria-label={pct == null ? '—' : `${pct}%`}>
        <circle cx="60" cy="60" r={R} fill="none" stroke="#EFE6D6" strokeWidth="14" />
        {pct != null ? <circle cx="60" cy="60" r={R} fill="none" stroke="#A96F22" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 60 60)" /> : null}
        <text x="60" y="67" textAnchor="middle" fontSize="21" fontWeight="800" fill="#6B4E1E">{pct == null ? '—' : `${Math.round(v * 10) / 10}%`}</text>
      </svg>
      <div className="cg-gauge-s">{children}</div>
    </div>
  );
}

/** what a customer was actually charged (ticket snapshots) — PII, so the phone is masked */
export function CustomerHistoryTable({ rows, onCustomer }: { rows: any[]; onCustomer?: (id: string, name: string) => void }) {
  return (
    <table className="fk-table fn-table cg-table" data-testid="customer-history-table">
      <thead><tr><th>{tx('cg.col.when')}</th><th>{tx('cg.col.customer')}</th><th>{tx('cg.col.item')}</th><th className="t-opt">{tx('cg.col.categoryAtSale')}</th><th className="num">{tx('cg.col.menuAtSale')}</th><th className="num">{tx('cg.col.charged')}</th><th className="t-opt">{tx('cg.col.technician')}</th><th>{tx('cg.col.ticket')}</th></tr></thead>
      <tbody>{rows.map((r: any) => <tr key={r.lineId} data-testid="customer-history-row">
        <td>{whenTime(r.at)}{!r.paid ? <span className="fk-li-s">{tx('cg.notPaid')}</span> : null}</td>
        <td>{r.customerId && onCustomer ? <button type="button" className="fk-li-t link" onClick={() => onCustomer(r.customerId, r.customerName ?? '')}>{r.customerName ?? tx('cg.walkIn')}</button> : <span className="fk-li-t">{r.customerName ?? tx('cg.walkIn')}</span>}<span className="fk-li-s">{r.maskedPhone ?? ''}</span></td>
        <td>{r.item}<span className="fk-li-s">{tx('cg.kind.' + (['service', 'add_on', 'retail'].includes(r.kind) ? r.kind : 'service'))}{r.minutes ? ` · ${mins(r.minutes)}` : ''}</span></td>
        <td className="t-opt">{r.categoryAtSale ?? '—'}</td>
        <td className="num">{money(r.catalogPriceAtSaleCents)}</td>
        <td className="num"><b>{fmtMoney(r.chargedCents)}</b></td>
        <td className="t-opt">{r.technician ?? '—'}</td>
        <td>{r.ticketNumber ? `#${r.ticketNumber}` : '—'}</td>
      </tr>)}</tbody>
    </table>
  );
}

/** Edit Pricing: price and / or duration, a reason, and the version the editor opened (a newer save is refused with 409). */
export function EditPricingDialog({ service, onClose, onSaved }: { service: any; onClose: () => void; onSaved: (msg: string) => void }) {
  const [price, setPrice] = useState(textFromCents(service.priceCents));
  const [dur, setDur] = useState(String(service.durationMinutes || ''));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const cents = centsFromText(price); const m = Number(dur);
  const changed = (cents != null && cents !== service.priceCents) || (Number.isInteger(m) && m !== service.durationMinutes);
  const valid = cents != null && cents >= 0 && Number.isInteger(m) && m > 0 && m <= 1440;
  const save = async () => {
    if (!valid) { setErr(tx('cg.pricing.invalid')); return; }
    if (!reason.trim()) { setErr(tx('cg.reasonRequired')); return; }
    setBusy(true); setErr(null);
    try {
      await posCatalogApi.updatePricing(service.serviceId, { priceCents: cents, durationMinutes: m, reason: reason.trim(), expectedUpdatedAt: service.updatedAt });
      onSaved(tx('cg.pricing.saved', { name: service.name }));
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('cg.pricing.title', { name: service.name })} subtitle={tx('cg.pricing.sub')} onClose={onClose} busy={busy} testId="dlg-pricing"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy || !changed} data-testid="pricing-save">{busy ? tx('pos.saving_2') : tx('pos.save_changes_2')}</button></>}>
      <div className="cg-form">
        <label className="fk-field">{tx('cg.f.price')}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="pricing-price" /><span className="fk-hint">{tx('cg.f.was', { v: fmtMoney(service.priceCents) })}</span></label>
        <label className="fk-field">{tx('cg.f.duration')}<input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ''))} data-testid="pricing-duration" /><span className="fk-hint">{tx('cg.f.was', { v: mins(service.durationMinutes) })}</span></label>
        <label className="fk-field wide">{tx('cg.f.reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={tx('cg.f.reasonPh')} data-testid="pricing-reason" /></label>
      </div>
      <p className="fk-hint">{tx('cg.pricing.rule')}</p>
      {err ? <div className="fk-note bad" role="alert" data-testid="pricing-error"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

/** New / Edit Service (the services module owns the write; its own audit + catalog_change_log record it). */
export function ServiceDialog({ service, categories, onClose, onSaved }: { service: any | null; categories: { categoryId: string; name: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(service?.name ?? ''); const [cat, setCat] = useState(service?.categoryId ?? '');
  const [price, setPrice] = useState(service ? textFromCents(service.priceCents) : ''); const [dur, setDur] = useState(service ? String(service.durationMinutes || '') : '');
  const [status, setStatus] = useState(service?.status === 'inactive' ? 'inactive' : 'active');
  const [online, setOnline] = useState(service ? !!service.onlineBookable : false); const [ai, setAi] = useState(service ? !!service.aiBookable : false);
  const [desc, setDesc] = useState(service?.description ?? '');
  const [taxable, setTaxable] = useState(service ? service.taxable !== false : true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!service && !cat && categories.length) setCat(categories[0].categoryId); }, [categories]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const cents = centsFromText(price || '0'); const m = Number(dur);
    if (!name.trim()) { setErr(tx('pos.name_is_required')); return; }
    if (!cat) { setErr(tx('pos.pick_a_category')); return; }
    if (cents == null || cents < 0) { setErr(tx('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    if (!Number.isInteger(m) || m <= 0) { setErr(tx('pos.duration_must_be_a_positive_number')); return; }
    // editing: a price / duration change goes through Service Pricing (reason, conflict check, history) like the Pricing screen —
    // it used to go through the plain update with no reason and no history entry; unchanged price / duration is not sent at all
    const priceChanged = !!service && (cents !== Number(service.priceCents) || m !== Number(service.durationMinutes));
    if (priceChanged && !reason.trim()) { setErr(tx('cg.svc.reasonNeeded')); return; }
    setBusy(true); setErr(null);
    try {
      const common = { name: name.trim(), categoryId: cat, status, onlineBookingEnabled: online, aiBookingEnabled: ai, description: desc.trim() || undefined };
      if (service) {
        if (priceChanged) await posCatalogApi.updatePricing(service.serviceId, { priceCents: cents, durationMinutes: m, reason: reason.trim(), ...(service.updatedAt ? { expectedUpdatedAt: service.updatedAt } : {}) });
        await posServicesApi.update(service.serviceId, common);
        if (taxable !== (service.taxable !== false)) await posServicesApi.setTaxable(service.serviceId, taxable);
      } else {
        const made: any = await posServicesApi.create({ ...common, priceCents: cents, durationMinutes: m });
        const newId = made?.serviceId ?? made?.id;
        if (!taxable && newId) await posServicesApi.setTaxable(String(newId), false);
      }
      onSaved(service ? tx('cg.svc.saved', { name: name.trim() }) : tx('cg.svc.created', { name: name.trim() }));
    } catch (e) { setErr(errorTextOf(e, tx('pos.save_failed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={service ? tx('cg.svc.editTitle', { name: service.name }) : tx('cg.svc.newTitle')} onClose={onClose} busy={busy} testId="dlg-service"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="service-save">{busy ? tx('pos.saving_2') : service ? tx('pos.save_changes_2') : tx('cg.svc.create')}</button></>}>
      <div className="cg-form">
        <label className="fk-field wide">{tx('cg.f.name')}<input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="service-name" /></label>
        <label className="fk-field">{tx('cg.f.category')}<select value={cat} onChange={(e) => setCat(e.target.value)} data-testid="service-category">{categories.length === 0 ? <option value="">{tx('cg.noCategories')}</option> : null}{categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select></label>
        <label className="fk-field">{tx('cg.f.status')}<select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="service-status"><option value="active">{tx('cg.status.active')}</option><option value="inactive">{tx('cg.status.inactive')}</option></select></label>
        <label className="fk-field">{tx('cg.f.price')}<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="service-price" /></label>
        <label className="fk-field">{tx('cg.f.duration')}<input inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value.replace(/\D/g, ''))} data-testid="service-duration" /></label>
        <label className="fk-field wide">{tx('cg.f.description')}<input value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} /></label>
        {service && (centsFromText(price || '0') !== Number(service.priceCents) || Number(dur) !== Number(service.durationMinutes))
          ? <label className="fk-field wide">{tx('cg.f.reason')}<input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder={tx('cg.f.reasonPh')} data-testid="service-reason" /></label> : null}
        <label className="cg-chk"><input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} data-testid="service-online" /> {tx('cg.f.online')}</label>
        <label className="cg-chk"><input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} /> {tx('cg.f.ai')}</label>
        <label className="cg-chk"><input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} data-testid="service-taxable" /> {tx('cg.f.taxable')}</label>
      </div>
      {service && taxable !== (service.taxable !== false) ? <p className="fk-hint" data-testid="service-taxable-hint">{tx('cg.f.taxableHint')}</p> : null}
      {service ? <p className="fk-hint">{tx('cg.svc.historyRule')}</p> : null}
      {err ? <div className="fk-note bad" role="alert" data-testid="service-error"><span>{err}</span></div> : null}
    </FitDialog>
  );
}

/** a service's / category's / add-on's change history (catalog_change_log, append-only, newest first) */
export function ChangeHistoryTable({ rows, showItem = true }: { rows: any[]; showItem?: boolean }) {
  return (
    <table className="fk-table fn-table cg-table" data-testid="change-history-table">
      <thead><tr><th>{tx('cg.col.when')}</th>{showItem ? <th>{tx('cg.col.item')}</th> : null}<th>{tx('cg.col.field')}</th><th>{tx('cg.col.change')}</th><th>{tx('cg.col.reason')}</th><th className="t-opt">{tx('cg.col.by')}</th></tr></thead>
      <tbody>{rows.map((h: any) => <tr key={h.id} data-testid="change-row">
        <td>{whenTime(h.changedAt)}</td>
        {showItem ? <td>{h.serviceName ?? h.categoryName ?? h.entityId}<span className="fk-li-s">{tx('cg.src.' + (['pos', 'import', 'pricing_editor', 'reassignment', 'add_ons'].includes(h.source) ? h.source : 'pos'))}</span></td> : null}
        <td>{fieldText(h.field)}</td>
        <td>{changeValue(h.field, h.oldValue)} → <b>{changeValue(h.field, h.newValue)}</b></td>
        <td className="cg-reason">{h.reason ?? <span className="fk-muted">{tx('cg.noReason')}</span>}</td>
        <td className="t-opt">{h.actor ?? '—'}</td>
      </tr>)}</tbody>
    </table>
  );
}
