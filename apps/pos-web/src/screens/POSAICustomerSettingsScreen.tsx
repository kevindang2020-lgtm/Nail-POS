// POSAICustomerSettingsScreen.tsx — AI Center → Customer Profile → Settings (/tenant/ai/customer-profile/settings).
// Customer AI Settings guide (Nov 1 2026). Rebuilt IN PLACE: the title ("Settings"), the description ("Effective AI Customer
// Profile settings for this salon"), the Assistant state with Disable / Enable for this salon, and the five thresholds with
// their exact labels stay — always visible together, never paginated. Added, from /pos/customer-ai-settings/*:
//   • a status strip that keeps the separate questions apart — the salon switch, the package (Super Admin) + subscription
//     decision, what is effective for this session, and whether the evaluations used the current values;
//   • per-threshold provenance (value, default, which level set it, allowed range) and the last recorded change;
//   • safe changes: a confirmation naming the salon, the change and the role; version-checked saves; a read-only impact
//     preview before saving thresholds; Reset to defaults;
//   • History (search, presets + From/To month calendar, numbered pages, newest first, a detail overlay with before / after and
//     whether the evaluations picked it up) and System Health (Check Customer AI System, read-only).
// The old note said per-salon overrides are managed from Super Admin — they are not (Super Admin has the package switch); the
// note now says what is true. Nothing here books, texts, bills or reaches another salon.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCustomerAiSettingsApi as api, type CustomerAiThresholds } from '../api/posCustomerAiSettingsApi';
import { errorTextOf } from '../i18n/error-text';
import { statusLabel } from '../i18n/status-label';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = true) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const KEYS = ['minVisitsForServicePref', 'minVisitsForTechPref', 'minVisitsForCadence', 'inactiveDays', 'longTermInactiveDays'] as const;
type Key = (typeof KEYS)[number];
const LABEL: Record<Key, string> = { minVisitsForServicePref: 'growth.aiProfile.setting.minServiceVisits', minVisitsForTechPref: 'growth.aiProfile.setting.minTechVisits',
  minVisitsForCadence: 'growth.aiProfile.setting.minCadenceVisits', inactiveDays: 'growth.aiProfile.setting.inactiveAfter', longTermInactiveDays: 'growth.aiProfile.setting.longTermAfter' };
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const EVENT_TYPES = ['assistant_enabled', 'assistant_disabled', 'thresholds_changed', 'thresholds_reset'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const KNOWN = ['CAS_STALE_VERSION', 'CAS_NO_CHANGE', 'CAS_OUT_OF_RANGE', 'CAS_ORDER', 'CAS_INVALID_VALUE', 'CAS_VERSION_REQUIRED', 'CAS_INVALID_PERIOD', 'CAS_EVENT_NOT_FOUND', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN.includes(code)) return t('casx.err.' + code);
  if (isForbidden(e)) return t('casx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
const valueText = (unit: string, n: number) => t('casx.unit.' + unit, { n: fmtNumber(n) });

export function POSAICustomerSettingsScreen() {
  const can = useCan();
  const manage = can('pos.ai_customer_profile.churn');
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'thresholds' | 'history' | 'health'>('thresholds');
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    setErr(null);
    try { setS(await api.state()); } catch (e) { setErr(errText(e, 'casx.loadFailed')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const a = s?.assistant; const e = s?.entitlement;
  const on = a ? a.salon !== 'disabled' : true;

  return (
    <div className="work rvw casx" data-testid="customer-ai-settings-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.settings')}</h1><div className="sub mb-3">{t('pos.effective_ai_customer_profile_settings_for_1fmy')}</div></div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="casx-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      {!s && !err ? <div className="state">{t('casx.loading')}</div> : null}
      {s ? <>
        <section className="panel" style={{ padding: 16 }} data-testid="casx-assistant">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <strong>{t('pos.assistant')}</strong>
            <span className={'chip ' + (on ? 'ok' : 'bad')} data-testid="casx-salon-state">{on ? t('pos.enabled') : t('pos.disabled')}</span>
            {manage ? <button className="btn sm:ml-auto ml-0" data-testid="casx-toggle" onClick={() => setConfirm(!on)}>{on ? t('pos.disable_for_this_salon') : t('pos.enable_for_this_salon')}</button>
              : <span className="sub sm:ml-auto">{t('casx.notAllowed')}</span>}
          </div>
          {/* Customer AI Settings SUNMI guide (Nov 9 2026): three equal status cards — the salon switch now sits with the effective state */}
          <div className="rvw-kpis casx-strip3" style={{ marginTop: 12 }} data-testid="casx-strip">
            <div className="kpi" data-testid="casx-package"><div className="l">{t('casx.strip.package')}</div><div className="v" style={{ fontSize: 15 }}>{t('casx.ent.' + e.reason)}</div>
              <div className="sub">{t('casx.mode.' + e.enforcement)}</div></div>
            <div className="kpi" data-testid="casx-effective"><div className="l">{t('casx.strip.effective')}</div><div className="v" style={{ fontSize: 15 }}>{t('casx.op.' + a.operational)}</div>
              <div className="sub" data-testid="casx-salon">{t('casx.strip.salon')}: <b>{t('casx.salon.' + a.salon)}</b></div>
              {a.disabledAtLevel ? <div className="sub">{t('casx.disabledAt', { l: t('casx.level.' + a.disabledAtLevel) })}</div> : null}
              {a.branchOverride === 'disabled' ? <div className="sub">{t('casx.branchOff')}</div> : null}
              {a.userOverride === 'disabled' ? <div className="sub">{t('casx.userOff')}</div> : null}</div>
            <div className="kpi" data-testid="casx-propagation"><div className="l">{t('casx.strip.evaluations')}</div>
              <div className="sub">{t('casx.prop.ci')}: <b>{t('casx.prop.' + s.propagation.customerIntelligence.state)}</b></div>
              <div className="sub">{t('casx.prop.sr')}: <b>{t('casx.prop.' + s.propagation.serviceRecommendations.state)}</b></div></div>
          </div>
        </section>

        <div className="rvw-tabs" role="tablist" data-testid="casx-tabs">
          {(['thresholds', 'history', 'health'] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={'btn ghost' + (tab === x ? ' on' : '')} data-testid={`tab-${x}`} onClick={() => setTab(x)}>{t('casx.tab.' + x)}</button>)}
        </div>

        {tab === 'thresholds' ? <section className="panel" style={{ padding: 0, overflow: 'hidden' }} data-testid="casx-thresholds">
          <div className="p-h" style={{ padding: '14px 14px 0', display: 'flex', gap: 8, alignItems: 'center' }}>{t('pos.thresholds')}
            {manage ? <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}><button className="btn ghost" data-testid="casx-edit" onClick={() => setEditing(true)}>{t('casx.edit')}</button></span> : null}</div>
          <div className="rvw-table-wrap"><table className="tbl w-full">
            <thead><tr><th>{t('pos.setting')}</th><th style={{ textAlign: 'right' }}>{t('pos.value')}</th><th>{t('casx.col.default')}</th><th>{t('casx.col.source')}</th><th>{t('casx.col.range')}</th></tr></thead>
            <tbody>{s.thresholds.map((r: any) => (
              <tr key={r.key} data-testid={`row-${r.key}`}>
                <td>{t(LABEL[r.key as Key])}{r.ignoredAt.length ? <div className="sub warn">{t('casx.ignored', { l: t('casx.level.' + r.ignoredAt[0]) })}</div> : null}</td>
                <td style={{ textAlign: 'right' }}><b data-testid={`val-${r.key}`}>{valueText(r.unit, r.value)}</b></td>
                <td className="sub">{valueText(r.unit, r.default)}</td>
                <td><span className={'chip ' + (r.source === 'default' ? '' : 'gold')} data-testid={`src-${r.key}`}>{t('casx.src.' + r.source)}</span></td>
                <td className="sub">{fmtNumber(r.bounds.min)}–{fmtNumber(r.bounds.max)}</td>
              </tr>))}</tbody>
          </table></div>
          <div className="sub" style={{ padding: 14 }} data-testid="casx-last">
            {s.lastChange ? t('casx.lastChange', { at: when(s.lastChange.at), by: s.lastChange.by ?? '—' }) : t('casx.noChange')}
            <div>{t('casx.superAdminNote')}</div><div>{t('casx.scopeNote')}</div>
          </div>
        </section>
          : tab === 'history' ? <HistoryTab />
          : <HealthTab />}
      </> : null}

      {confirm !== null && s ? <ConfirmAssistant enable={confirm} version={s.salonRow.version} onClose={() => setConfirm(null)}
        onDone={(r) => { setConfirm(null); setS(r.state); setNotice(t('casx.saved', { v: fmtNumber(r.version) })); }} onStale={() => { setConfirm(null); void load(); }} /> : null}
      {editing && s ? <EditThresholds state={s} onClose={() => setEditing(false)}
        onDone={(r) => { setEditing(false); setS(r.state); setNotice(t('casx.saved', { v: fmtNumber(r.version) })); }} onStale={() => { setEditing(false); void load(); }} /> : null}
    </div>
  );
}

function ConfirmAssistant({ enable, version, onClose, onDone, onStale }: { enable: boolean; version: number; onClose: () => void; onDone: (r: any) => void; onStale: () => void }) {
  const { principal } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { onDone(await api.setAssistant({ enabled: enable, expectedVersion: version, reason: reason.trim() || undefined })); }
    catch (e: any) { if ((e?.body?.code ?? e?.code) === 'CAS_STALE_VERSION') onStale(); setErr(errText(e, 'casx.saveFailed')); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog testId="casx-confirm" busy={busy} title={t('casx.confirmTitle')} onClose={onClose}
      footer={<div className="rvw-ov-foot"><button className="btn ghost" onClick={onClose} disabled={busy}>{t('casx.cancel')}</button>
        <button className="btn" data-testid="casx-confirm-go" disabled={busy} onClick={() => void go()}>{enable ? t('pos.enable_for_this_salon') : t('pos.disable_for_this_salon')}</button></div>}>
      <p data-testid="casx-confirm-text">{t(enable ? 'casx.confirmEnable' : 'casx.confirmDisable', { salon: t('casx.thisSalon') })}</p>
      {principal?.role ? <p className="sub">{t('casx.confirmRole', { role: statusLabel('role', principal.role) })}</p> : null}
      <p className="sub">{t('casx.scopeNote')}</p>
      <label className="rvw-f"><span>{t('casx.reason')}</span><textarea data-testid="casx-reason" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
      {err ? <p className="err" role="alert" data-testid="casx-confirm-err">{err}</p> : null}
    </FitDialog>
  );
}

function EditThresholds({ state, onClose, onDone, onStale }: { state: any; onClose: () => void; onDone: (r: any) => void; onStale: () => void }) {
  const init = Object.fromEntries(state.thresholds.map((r: any) => [r.key, String(r.value)])) as Record<Key, string>;
  const [draft, setDraft] = useState<Record<Key, string>>(init);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bound = (k: Key) => state.thresholds.find((r: any) => r.key === k);
  const changed = (): CustomerAiThresholds => Object.fromEntries(KEYS.filter((k) => draft[k] !== init[k]).map((k) => [k, Number(draft[k])]));
  const invalid = KEYS.filter((k) => { const n = Number(draft[k]); const b = bound(k).bounds; return !Number.isInteger(n) || n < b.min || n > b.max; });
  const fail = (e: any) => { if ((e?.body?.code ?? e?.code) === 'CAS_STALE_VERSION') onStale(); setErr(errText(e, 'casx.saveFailed')); };
  const doPreview = async () => { setBusy(true); setErr(null); try { setPreview(await api.preview(changed())); } catch (e) { fail(e); } finally { setBusy(false); } };
  const save = async (reset = false) => {
    setBusy(true); setErr(null);
    try { onDone(await api.setThresholds(reset ? { reset: true, expectedVersion: state.salonRow.version, reason: reason.trim() || undefined } : { values: changed(), expectedVersion: state.salonRow.version, reason: reason.trim() || undefined })); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const nothing = !Object.keys(changed()).length;
  return (
    <FitDialog wide testId="casx-edit-dialog" busy={busy} title={t('casx.edit')} onClose={onClose}
      footer={<div className="rvw-ov-foot"><button className="btn ghost" onClick={onClose} disabled={busy}>{t('casx.cancel')}</button>
        <button className="btn ghost" data-testid="casx-reset" disabled={busy} onClick={() => void save(true)}>{t('casx.reset')}</button>
        <button className="btn ghost" data-testid="casx-preview" disabled={busy || nothing || invalid.length > 0} onClick={() => void doPreview()}>{t('casx.preview')}</button>
        <button className="btn" data-testid="casx-save" disabled={busy || nothing || invalid.length > 0} onClick={() => void save()}>{t('casx.save')}</button></div>}>
      <table className="tbl w-full"><tbody>{KEYS.map((k) => {
        const b = bound(k); const p = preview?.items?.find((x: any) => x.key === k);
        return <tr key={k}><td>{t(LABEL[k])}</td>
          <td><input type="number" inputMode="numeric" data-testid={`in-${k}`} min={b.bounds.min} max={b.bounds.max} value={draft[k]} onChange={(ev) => { setPreview(null); setDraft((d) => ({ ...d, [k]: ev.target.value })); }} style={{ width: 90 }} /></td>
          <td className="sub" data-testid={`pv-${k}`}>{invalid.includes(k) ? <span className="warn">{t('casx.invalid', { min: fmtNumber(b.bounds.min), max: fmtNumber(b.bounds.max) })}</span>
            : p ? (p.affected == null ? '—' : t('casx.affected', { n: fmtNumber(p.affected) })) : draft[k] === init[k] ? t('casx.unchanged') : ''}</td></tr>;
      })}</tbody></table>
      {preview ? <p className="sub" data-testid="casx-preview-note">{t('casx.previewNote')}</p> : null}
      <label className="rvw-f"><span>{t('casx.reason')}</span><textarea data-testid="casx-th-reason" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
      <p className="sub">{t('casx.scopeNote')}</p>
      {err ? <p className="err" role="alert" data-testid="casx-edit-err">{err}</p> : null}
    </FitDialog>
  );
}

function HistoryTab() {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; type?: string; preset?: string; from?: string; to?: string; page: number; pageSize: number }>({ page: 1, pageSize: 25 });
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setErr(null); api.history(f).then(setD).catch((e) => setErr(errText(e, 'casx.loadFailed'))); }, [f]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const any = !!(f.q || f.type || f.preset);
  return (
    <section className="panel rvw-feed" data-testid="casx-history">
      <form className="rvw-filters" onSubmit={(ev) => { ev.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="casx-hist-search" value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder={t('casx.searchHistory')} aria-label={t('casx.searchHistory')} />
        <button className="btn" type="submit">{t('casx.search')}</button>
        <select data-testid="casx-hist-type" value={f.type ?? ''} onChange={(ev) => set({ type: ev.target.value || undefined })}>
          <option value="">{t('casx.anyType')}</option>{EVENT_TYPES.map((x) => <option key={x} value={x}>{t('casx.event.' + x)}</option>)}
        </select>
        {any ? <button className="btn ghost" type="button" data-testid="casx-hist-clear" onClick={() => { setDraft(''); setF({ page: 1, pageSize: f.pageSize }); }}>{t('casx.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!f.preset ? ' on' : '')} onClick={() => set({ preset: undefined, from: undefined, to: undefined })}>{t('casx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`hist-preset-${p}`} onClick={() => set({ preset: p, from: undefined, to: undefined })}>{t('casx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="hist-preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('casx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={d?.period?.today ?? deviceToday()}
        onApply={(r) => { set({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { set({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('casx.loading')}</div> : d.items.length === 0 ? <Empty title={any ? t('casx.noMatch') : t('casx.noHistory')} /> : (
        <table className="tbl rvw-table"><thead><tr><th>{t('casx.hist.when')}</th><th>{t('casx.hist.change')}</th><th>{t('casx.hist.keys')}</th><th>{t('casx.hist.by')}</th><th>{t('casx.hist.version')}</th></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.id} data-testid="casx-hist-row" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen(r.id); }}>
            <td className="nowrap">{when(r.at)}</td><td>{t('casx.event.' + r.type)}</td><td>{r.changedKeys.map((k: string) => (LABEL as Record<string, string>)[k] ? t(LABEL[k as Key]) : t('casx.ov.assistant')).join(', ')}</td>
            <td>{r.actor ?? '—'}{r.role ? <div className="sub">{statusLabel('role', r.role)}</div> : null}</td><td className="num">{fmtNumber(r.version)}</td></tr>)}</tbody></table>)}
      <div className="rvw-pager">
        <Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('casx.rows')}</span>
          <select value={String(f.pageSize)} onChange={(ev) => set({ pageSize: Number(ev.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {open ? <EventOverlay id={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function EventOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.event(id).then(setD).catch((e) => setErr(errText(e, 'casx.loadFailed'))); }, [id]);
  const side = (v: any) => (
    <ul>{v?.enabled !== undefined ? <li>{t('casx.ov.assistant')}: {v.enabled === false ? t('casx.ov.off') : v.enabled === true ? t('casx.ov.on') : t('casx.ov.inherit')}</li> : null}
      {KEYS.filter((k) => v?.tunables?.[k] !== undefined).map((k) => <li key={k}>{t(LABEL[k])}: {fmtNumber(v.tunables[k])}</li>)}</ul>);
  return (
    <FitDialog wide testId="casx-event" title={t('casx.ov.title')} subtitle={d ? `${t('casx.event.' + d.type)} · ${when(d.at)}` : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('casx.close')}</button>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('casx.loading')}</div> : <>
        <dl className="rvw-dl">
          <dt>{t('casx.ov.id')}</dt><dd className="sub">{d.id}</dd>
          <dt>{t('casx.hist.by')}</dt><dd>{d.actor ?? '—'}{d.role ? ` · ${statusLabel('role', d.role)}` : ''}</dd>
          <dt>{t('casx.hist.version')}</dt><dd>{fmtNumber(d.version)}</dd>
          {d.reason ? <><dt>{t('casx.ov.reason')}</dt><dd>{d.reason}</dd></> : null}
        </dl>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div data-testid="casx-before"><h4>{t('casx.ov.before')}</h4>{side(d.before)}</div>
          <div data-testid="casx-after"><h4>{t('casx.ov.after')}</h4>{side(d.after)}</div>
        </div>
        <h4>{t('casx.ov.propagation')}</h4>
        <ul data-testid="casx-event-propagation">
          <li>{t('casx.prop.ci')}: {d.propagation.customerIntelligence.state === 'applied' ? t('casx.ov.appliedAt', { at: when(d.propagation.customerIntelligence.at) }) : t('casx.ov.pendingRefresh')}</li>
          <li>{t('casx.prop.sr')}: {d.propagation.serviceRecommendations.state === 'applied' ? t('casx.ov.appliedAt', { at: when(d.propagation.serviceRecommendations.at) }) : t('casx.ov.pendingRefresh')}</li>
        </ul>
      </>}
    </FitDialog>
  );
}

function HealthTab() {
  const [d, setD] = useState<any | 'loading' | null>(null);
  const run = () => { setD('loading'); api.check().then(setD).catch((e) => setD({ error: errText(e, 'casx.loadFailed') })); };
  return (
    <section className="panel rvw-feed" data-testid="casx-health">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="btn" data-testid="casx-check" onClick={run}>{t('casx.check')}</button><span className="sub">{t('casx.health.intro')}</span></div>
      {d === null ? null : d === 'loading' ? <div className="state">{t('casx.health.running')}</div> : d.error ? <div className="err">{d.error}</div> : <>
        <p className="sub" data-testid="casx-health-overall">{t('casx.health.overall', { s: t('casx.health.' + d.overall), at: when(d.checkedAt) })}{d.reused ? ` ${t('casx.health.recent')}` : ''}</p>
        {d.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('casx.health.' + x.state)}</span> <b>{t('casx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('casx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </section>
  );
}
