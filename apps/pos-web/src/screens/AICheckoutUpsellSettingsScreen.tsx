// AICheckoutUpsellSettingsScreen.tsx — AI Center → Checkout Upsell Assistant → Settings (/tenant/ai/checkout-upsell/settings).
// Enable/disable (kill switch), the seven category switches, the three limits (+ Decision 27's two value caps). Disabling the
// assistant never affects checkout, payments or any domain module, and never cancels the AI subscription.
//
// Checkout Upsell Settings guide (Nov 2 2026):
//   • a save sends ONLY the changed key + the version it read (a toggle used to send back the whole RESOLVED set — platform
//     defaults and branch / user overrides got baked into the salon's row — and Disable / Enable wiped every category and
//     limit); a 409 says someone else saved first and reloads; an out-of-range value is refused, not clamped;
//   • 403 is read from the error itself (it used to look for "403" in the message text, so it never matched);
//   • the status row says the EFFECTIVE state and why (salon switch, an unreadable setting, the subscription), and each
//     category says whether it is connected to a real source — a checked box that can never produce a card says so;
//   • Disable asks first and says what it does and does not do;
//   • below: Suggestion Activity · Settings History · System Health (search, presets + month calendar, numbered pages).
import { useCallback, useEffect, useState } from 'react';
import { posAiCheckoutUpsellApi as apiU } from '../api/posAiCheckoutUpsellApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { money } from './reportsCommon';
import { statusLabel } from '../i18n/status-label';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'addOnsEnabled', get label() { return tx('pos.service_add_ons'); } }, { key: 'productsEnabled', get label() { return tx('pos.retail_products'); } },
  { key: 'membershipEnabled', get label() { return tx('pos.memberships'); } }, { key: 'loyaltyEnrollEnabled', get label() { return tx('pos.loyalty_enrollment'); } },
  { key: 'loyaltyRedeemEnabled', get label() { return tx('pos.loyalty_redemption'); } }, { key: 'giftCardEnabled', get label() { return tx('pos.gift_cards_2'); } },
  { key: 'rebookingEnabled', get label() { return tx('pos.rebooking'); } },
];
const CAPS: { key: string; label: string; max: number }[] = [
  { key: 'maxTotal', get label() { return tx('pos.max_suggestions_shown'); }, max: 8 }, { key: 'maxAddOn', get label() { return tx('pos.max_add_ons'); }, max: 5 }, { key: 'maxProduct', get label() { return tx('pos.max_products'); }, max: 5 },
];
const TYPES = ['all', 'service_addon', 'product', 'membership', 'loyalty_enrollment', 'loyalty_redemption', 'gift_card', 'next_appointment', 'promotion'] as const;
const STATUSES = ['all', 'GENERATED', 'DISPLAYED', 'ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'INELIGIBLE', 'OUT_OF_STOCK', 'FAILED'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const EFF_TONE: Record<string, 'ok' | 'warn' | 'bad' | undefined> = { enabled: 'ok', disabled: 'warn', subscription_restricted: 'warn', subscription_unknown: 'warn', unknown: 'bad' };
type Period = { preset?: string; from?: string; to?: string };

function saveErr(e: unknown) {
  const x = e as { body?: { code?: string; message?: string }; code?: string; message?: string; status?: number } | null;
  const code = x?.body?.code ?? x?.code ?? x?.body?.message ?? x?.message;
  if (isForbidden(e) || code === 'INSUFFICIENT_PERMISSION') return tx('pos.you_don_t_have_permission_to_144i');
  if (code === 'UPSELL_SETTINGS_VERSION_CONFLICT' || x?.status === 409) return t('ucx.err.conflict');
  if (code === 'UPSELL_SETTING_OUT_OF_RANGE') return t('ucx.err.range');
  return errorTextOf(e, tx('pos.could_not_save_2'));
}
function readErr(e: unknown, fallbackKey = 'ucx.loadFailed') {
  const x = e as { body?: { code?: string }; code?: string } | null;
  const code = x?.body?.code ?? x?.code;
  if (code === 'UC_INVALID_PERIOD') return t('ucx.err.period');
  if (isForbidden(e)) return t('ucx.err.forbidden');
  return errorTextOf(e, t(fallbackKey));
}

export function AICheckoutUpsellSettingsScreen() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [tab, setTab] = useState<'activity' | 'history' | 'health'>('activity');
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setS(await apiU.settings()); } catch (e) { setS(null); setErr(isForbidden(e) ? t('ucx.err.forbidden') : tx('pos.could_not_load_settings')); } finally { setLoading(false); }
    apiU.center.summary().then(setSum).catch(() => setSum(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: { enabled?: boolean; tunables?: Record<string, unknown> }) => {
    setBusy(true); setErr(null);
    try {
      setS(await apiU.updateSettings('tenant', { ...patch, expectedVersion: s?.salon?.version ?? 0 }));
      setTick((n) => n + 1);
      apiU.center.summary().then(setSum).catch(() => setSum(null));
    } catch (e) {
      setErr(saveErr(e));
      // someone else saved first — show what is there now (quietly: the message above stays)
      if ((e as { status?: number } | null)?.status === 409) apiU.settings().then(setS).catch(() => undefined);
    } finally { setBusy(false); }
  }, [s]);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_settings')}</div></div>;
  if (!s) return <div className="work"><div className="vh"><h1>{tx('pos.checkout_upsell_assistant')}</h1></div><ErrorRetry message={err ?? tx('pos.could_not_load_settings')} onRetry={load} /></div>;

  const tn = s?.tunables || {};
  const src = (k: string) => s?.sources?.[k] as string | undefined;
  const wired = (k: string) => sum?.categories?.find((c: any) => c.key === k)?.wired;
  const setKey = (key: string, val: unknown) => save({ tunables: { [key]: val } });
  const off = busy || !s?.enabled;
  const eff = sum?.effective as string | undefined;

  return (
    <div className="work" data-testid="ucx-page">
      <div className="vh">
        <h1>{tx('pos.checkout_upsell_assistant')}</h1>
        <div className="sub mb-3">{tx('pos.suggests_relevant_add_ons_products_memberships_14pd')}</div>
      </div>

      {err && <div className="err" role="alert" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: '#F9FAFB', border: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.assistant_status')}</div>
        <span data-testid="ucx-status" style={{ background: s?.enabled ? '#E8F5E9' : '#FDECEC', color: s?.enabled ? '#2E7D32' : '#B3261E', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', display: 'inline-block' }}>{s?.enabled ? tx('pos.enabled_2') : tx('pos.disabled_3')}</span>
        {!s?.enabled && s?.disabledAtLevel && <span style={{ fontSize: 13, color: '#6B7280' }}>{t('ucx.offAt.' + (['tenant', 'branch', 'device', 'user', 'settings_unreadable'].includes(s.disabledAtLevel) ? s.disabledAtLevel : 'other'))}</span>}
        {s?.salon ? <span className="sub" data-testid="ucx-version">{t('ucx.saved', { v: s.salon.version, at: when(s.salon.updatedAt) })}</span> : null}
        <div style={{ flex: 1 }} />
        <button className="btn whitespace-nowrap" style={{ height: 34, padding: '0 16px', fontSize: 13 }} disabled={busy} data-testid="ucx-toggle"
          onClick={() => (s?.enabled ? setConfirmOff(true) : save({ enabled: true }))}>
          {busy ? tx('pos.saving_2') : s?.enabled ? tx('pos.disable_for_this_salon') : tx('pos.enable_for_this_salon')}
        </button>
      </div>

      {sum ? <div className="rvw-kpis" data-testid="ucx-kpis" style={{ marginBottom: 16 }}>
        <KpiCard testId="ucx-kpi-effective" label={t('ucx.kpi.effective')} value={t('ucx.eff.' + (eff ?? 'unknown'))} tone={EFF_TONE[eff ?? 'unknown']} />
        <KpiCard testId="ucx-kpi-categories" label={t('ucx.kpi.categories')} value={t('ucx.kpi.catValue', { on: (sum.categories ?? []).filter((c: any) => c.on).length, live: (sum.categories ?? []).filter((c: any) => c.on && c.wired).length })} />
        <KpiCard testId="ucx-kpi-limits" label={t('ucx.kpi.limits')} value={sum.limits ? `${sum.limits.maxTotal ?? '—'} / ${sum.limits.maxAddOn ?? '—'} / ${sum.limits.maxProduct ?? '—'}` : '—'} />
        <KpiCard testId="ucx-kpi-health" label={t('ucx.kpi.health')} value={sum.lastCheck ? t('ucx.health.' + sum.lastCheck.overall) : t('ucx.notTested')} tone={sum.lastCheck ? (STATE_TONE[sum.lastCheck.overall] as 'ok' | 'warn' | 'bad' | undefined) : undefined} onClick={() => setTab('health')} />
      </div> : null}
      {sum?.subscription && !sum.subscription.allowed ? <div className="err" role="status" data-testid="ucx-sub" style={{ marginBottom: 12 }}>{t('ucx.subRestricted')}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="panel" style={{ flex: '1 1 300px', padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.suggestion_categories')}</div>
          <div style={{ padding: '0 16px' }}>
            {CATEGORIES.map((c, i) => (
              <label key={c.key} data-testid={`ucx-cat-${c.key}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', minHeight: 44, borderBottom: i < CATEGORIES.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14, color: '#374151', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1 }}>
                <input type="checkbox" checked={tn[c.key] !== false} disabled={off} onChange={(e) => setKey(c.key, e.target.checked)} style={{ width: 18, height: 18, cursor: 'inherit' }} />
                <span style={{ flex: 1 }}>{c.label}</span>
                {wired(c.key) === false ? <span className="chip warn" title={t('ucx.notConnectedHint')}>{t('ucx.notConnected')}</span> : null}
                {src(c.key) && src(c.key) !== 'tenant' ? <span className="sub">{t('ucx.src.' + src(c.key))}</span> : null}
              </label>
            ))}
          </div>
        </section>

        <section className="panel" style={{ flex: '1 1 300px', padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
          <div style={{ padding: '14px 16px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.limits')}</div>
          <div style={{ padding: '0 16px' }}>
            {/* Functional Decision 27: suggestions may add at most the LOWER of these two to a visit (defaults $30 / 30%). */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{tx('pos.max_added_value_per_visit')}</span>
              <select className="in" aria-label={tx('pos.max_added_value_per_visit')} value={Number(tn.maxAddedValueCents ?? 3000)} disabled={off} onChange={(e) => setKey('maxAddedValueCents', Number(e.target.value))} style={{ border: '1px solid var(--line)' }}>
                {[1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000].map((c) => <option key={c} value={c}>${c / 100}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{tx('pos.and_at_most_this_share_of_6115')}</span>
              <select className="in" aria-label={tx('pos.max_share_of_booked_services')} value={Number(tn.maxAddedPercent ?? 30)} disabled={off} onChange={(e) => setKey('maxAddedPercent', Number(e.target.value))} style={{ border: '1px solid var(--line)' }}>
                {[10, 15, 20, 25, 30, 40, 50].map((pc) => <option key={pc} value={pc}>{pc}%</option>)}
              </select>
            </div>
            {CAPS.map((c, i) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: i < CAPS.length - 1 ? '1px solid var(--line)' : 'none', fontSize: 14, color: '#374151', opacity: off ? 0.6 : 1 }}>
                <span>{c.label}{src(c.key) && src(c.key) !== 'tenant' ? <span className="sub"> · {t('ucx.src.' + src(c.key))}</span> : null}</span>
                <select className="in" aria-label={c.label} value={Number(tn[c.key] ?? 2)} disabled={off} onChange={(e) => setKey(c.key, Number(e.target.value))} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: '#fff', outline: 'none', cursor: off ? 'not-allowed' : 'pointer', width: 64, textAlign: 'center' }}>
                  {Array.from({ length: c.max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            ))}
            <p className="sub" style={{ padding: '8px 0' }}>{t('ucx.capNote')}</p>
          </div>
        </section>
      </div>
      <p className="sub" style={{ marginTop: 8 }}>{t('ucx.promise')}</p>

      <div style={{ display: 'flex', gap: 6, marginTop: 18, flexWrap: 'nowrap', overflowX: 'auto' }} role="tablist" aria-label={t('ucx.workspace')}>
        {(['activity', 'history', 'health'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={'btn ghost' + (tab === k ? ' on' : '')} data-testid={`ucx-tab-${k}`} onClick={() => setTab(k)}>{t('ucx.tab.' + k)}</button>)}
      </div>
      <div style={{ marginTop: 10 }}>
        {tab === 'activity' ? <ActivityCard tick={tick} /> : tab === 'history' ? <HistoryCard tick={tick} /> : <HealthCard onDone={() => apiU.center.summary().then(setSum).catch(() => setSum(null))} />}
      </div>

      {confirmOff ? <FitDialog testId="ucx-confirm-off" title={tx('pos.disable_for_this_salon')} onClose={() => setConfirmOff(false)}
        footer={<><button className="btn ghost" onClick={() => setConfirmOff(false)}>{t('ucx.cancel')}</button>
          <button className="btn" data-testid="ucx-confirm-off-yes" onClick={() => { setConfirmOff(false); save({ enabled: false }); }}>{tx('pos.disable_for_this_salon')}</button></>}>
        <p>{t('ucx.offExplain')}</p>
      </FitDialog> : null}
    </div>
  );
}

function Dates({ period, setPer, today }: { period: Period; setPer: (p: Period) => void; today?: string }) {
  const [cal, setCal] = useState(false);
  return <>
    <div className="rvw-dates">
      <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('ucx.preset.all')}</button>
      {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`ucx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('ucx.preset.' + p)}</button>)}
      <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} data-testid="ucx-preset-custom" onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('ucx.preset.custom')}</button>
    </div>
    {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={today ?? deviceToday()}
      onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
  </>;
}

function ActivityCard({ tick }: { tick: number }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; type: string; status: string; page: number; pageSize: number }>({ type: 'all', status: 'all', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); apiU.center.activity({ ...f, ...period, q: f.q }).then(setList).catch((e) => setErr(readErr(e))); }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const items: any[] = Array.isArray(list?.items) ? list.items : [];
  const any = !!(f.q || f.type !== 'all' || f.status !== 'all' || period.preset);
  return (
    <section className="panel rvw-feed" data-testid="ucx-activity" style={{ padding: 12 }}>
      <div className="p-h">{t('ucx.tab.activity')} <span className="sub">· {t('ucx.newestFirst')}{list ? ` · ${fmtNumber(list.total)}` : ''}</span></div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="ucx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t(list?.customersVisible === false ? 'ucx.searchPhNoCustomer' : 'ucx.searchPh')} aria-label={t('ucx.searchPh')} />
        <button className="btn" type="submit">{t('ucx.search')}</button>
        <select data-testid="ucx-type" aria-label={t('ucx.typeLabel')} value={f.type} onChange={(e) => set({ type: e.target.value })}>{TYPES.map((x) => <option key={x} value={x}>{t('ucx.type.' + x)}</option>)}</select>
        <select data-testid="ucx-statusf" aria-label={t('ucx.statusLabel')} value={f.status} onChange={(e) => set({ status: e.target.value })}>{STATUSES.map((x) => <option key={x} value={x}>{t('ucx.st.' + x)}</option>)}</select>
        {any ? <button className="btn ghost" type="button" onClick={() => { setDraft(''); setPeriod({}); set({ q: undefined, type: 'all', status: 'all' }); }}>{t('ucx.clear')}</button> : null}
      </form>
      <Dates period={period} setPer={(p) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); }} today={list?.period?.today} />
      <p className="sub">{t('ucx.activityNote')}</p>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('ucx.loading')}</div> : items.length === 0 ? <Empty title={any ? t('ucx.noMatch') : t('ucx.noActivity')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('ucx.col.when')}</th><th>{t('ucx.col.offer')}</th><th>{t('ucx.col.ticket')}</th><th>{t('ucx.col.status')}</th><th style={{ textAlign: 'right' }}>{t('ucx.col.price')}</th></tr></thead>
          <tbody>{items.map((r) => (
            <tr key={r.id} data-testid="ucx-row">
              <td className="nowrap">{when(r.createdAt)}</td>
              <td><b>{r.title}</b><div className="sub">{t('ucx.type.' + (TYPES.includes(r.type) ? r.type : 'all'))}</div></td>
              <td>{r.ticketNumber ?? `#${String(r.checkoutId).slice(0, 8)}`}{r.customer ? <div className="sub">{r.customer}{r.customerPhoneLast4 ? ` · •••${r.customerPhoneLast4}` : ''}</div> : null}{r.branch ? <div className="sub">{r.branch}</div> : null}</td>
              <td><span className={'chip ' + (r.status === 'APPLIED' ? 'ok' : r.status === 'FAILED' ? 'bad' : r.status === 'ACCEPTED' ? 'gold' : '')}>{t('ucx.st.' + (STATUSES.includes(r.status) ? r.status : 'all'))}</span>
                {r.acceptedBy ? <div className="sub">{t('ucx.by', { who: r.acceptedBy })}</div> : null}</td>
              <td className="num">{r.priceCents == null ? '—' : money(r.priceCents)}</td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('ucx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}

const valueText = (key: string, v: unknown) => (v === null || v === undefined ? t('ucx.inherit') : typeof v === 'boolean' ? t(v ? 'ucx.on' : 'ucx.off')
  : key === 'maxAddedValueCents' ? money(Number(v)) : key === 'maxAddedPercent' ? `${v}%` : String(v));
function HistoryCard({ tick }: { tick: number }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; page: number; pageSize: number }>({ page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); apiU.center.history({ ...f, ...period, q: f.q }).then(setList).catch((e) => setErr(readErr(e))); }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const items: any[] = Array.isArray(list?.items) ? list.items : [];
  return (
    <section className="panel rvw-feed" data-testid="ucx-history" style={{ padding: 12 }}>
      <div className="p-h">{t('ucx.tab.history')} <span className="sub">· {t('ucx.newestFirst')} · {t('ucx.historyNote')}</span></div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="ucx-history-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('ucx.historySearchPh')} aria-label={t('ucx.historySearchPh')} />
        <button className="btn" type="submit">{t('ucx.search')}</button>
      </form>
      <Dates period={period} setPer={(p) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); }} today={list?.period?.today} />
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('ucx.loading')}</div> : items.length === 0 ? <Empty title={t('ucx.noHistory')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('ucx.col.when')}</th><th>{t('ucx.col.change')}</th><th>{t('ucx.col.by')}</th><th>{t('ucx.col.version')}</th></tr></thead>
          <tbody>{items.map((h) => (
            <tr key={h.id} data-testid="ucx-hrow">
              <td className="nowrap">{when(h.at)}</td>
              <td>{(h.changes ?? []).map((c: any) => <div key={c.key}><b>{t('ucx.key.' + c.key)}</b>: {valueText(c.key, c.before)} → {valueText(c.key, c.after)}</div>)}
                {h.level !== 'tenant' ? <div className="sub">{t('ucx.src.' + h.level)}</div> : null}</td>
              <td>{h.actor ?? '—'}{h.role ? <div className="sub">{statusLabel('role', h.role)}</div> : null}</td>
              <td>v{h.version}</td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('ucx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}

function HealthCard({ onDone }: { onDone: () => void }) {
  const [data, setData] = useState<any | 'loading' | null>(null);
  const run = () => { setData('loading'); apiU.center.check().then((d) => { setData(d); onDone(); }).catch((e) => setData({ error: readErr(e) })); };
  return (
    <section className="panel" data-testid="ucx-health" style={{ padding: 12 }}>
      <div className="p-h">{t('ucx.tab.health')}</div>
      <p className="sub">{t('ucx.health.readOnly')}</p>
      <button className="btn" data-testid="ucx-check" onClick={run} disabled={data === 'loading'}>{t('ucx.check')}</button>
      {data === 'loading' ? <div className="state">{t('ucx.health.running')}</div> : data?.error ? <div className="err">{data.error}</div> : data ? <>
        <p className="sub">{t('ucx.health.overall', { s: t('ucx.health.' + data.overall), at: when(data.checkedAt) })}{data.reused ? ` ${t('ucx.health.recent')}` : ''}</p>
        {(data.checks ?? []).map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`ucx-chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('ucx.health.' + x.state)}</span> <b>{t('ucx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('ucx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </> : null}
    </section>
  );
}
