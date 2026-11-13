// POSAIReviewReputationSettingsScreen.tsx — AI Center → AI Review & Reputation → Settings (/tenant/ai/reputation/settings).
// Review & Reputation Settings guide (Nov 1 2026). Rebuilt IN PLACE: the title, the description, Save Changes and the eight
// photographed controls in their three sections (Assistant · Controlled auto-response · Post-visit review requests) stay,
// with their labels and help text. What changed (from /pos/reputation-settings/*):
//   • Save is version-checked, MERGES (it used to rewrite the whole policy and swallowed every error, so "Saved" could show
//     for a save that never happened), records who / what / why in History, and asks for confirmation with the changes listed;
//   • automatic replies and "Require approval" cannot both be on — the server refuses it, and the screen says so first;
//   • each control shows where its value comes from, and a status strip keeps the separate questions apart: the salon switch,
//     the package / subscription, the salon's SMS sender, review providers;
//   • the screen says what actually runs: a reply is only ever published from an approved draft; nothing runs automatic
//     replies; requests are scheduled at checkout but no sender delivers them yet; no reminder sender exists;
//   • unsaved changes are marked and kept after a failed save; leaving warns;
//   • History (search, presets + From/To month calendar, numbered pages, newest first, a before → after overlay) and System
//     Health (Check Reputation Settings, read-only). Nothing here publishes, approves, messages anyone or charges.
import { useCallback, useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posReputationSettingsApi as api, type ReputationSettingsValues } from '../api/posReputationSettingsApi';
import { errorTextOf } from '../i18n/error-text';
import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const KEYS = ['enabled', 'responseTone', 'approvalRequired', 'autoResponse', 'requestsEnabled', 'channel', 'delayMinutes', 'oneReminder'] as const;
type Key = (typeof KEYS)[number];
type Vals = Record<Key, any>;
const LABEL: Record<Key, string> = { enabled: 'pos.enable_the_assistant', responseTone: 'pos.response_tone', approvalRequired: 'pos.require_approval_before_publishing',
  autoResponse: 'pos.enable_auto_response_for_clean_5_1jow', requestsEnabled: 'pos.send_a_review_request_after_a_1vc6', channel: 'pos.channel', delayMinutes: 'pos.delay_after_visit_minutes', oneReminder: 'pos.send_one_reminder' };
const TONES = ['professional', 'warm', 'luxury', 'friendly', 'concise', 'apologetic', 'brand'];
const CHANNELS = ['sms', 'email', 'app'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const EVENT_TYPES = ['settings_changed', 'assistant_enabled', 'assistant_disabled'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const KNOWN = ['RSS_STALE_VERSION', 'RSS_NO_CHANGE', 'RSS_INVALID_VALUE', 'RSS_POLICY_CONFLICT', 'RSS_VERSION_REQUIRED', 'RSS_INVALID_PERIOD', 'RSS_EVENT_NOT_FOUND', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN.includes(code)) return t('rssx.err.' + code);
  if (isForbidden(e)) return t('rssx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
/** a control's value as words (booleans On / Off, tone and channel localized, minutes with a unit) */
function valueText(k: Key, v: unknown) {
  if (v === null || v === undefined) return t('rssx.unknown');
  if (typeof v === 'boolean') return v ? t('rssx.on') : t('rssx.off');
  if (k === 'responseTone') return t('rssx.tone.' + v);
  if (k === 'channel') return t('rssx.chan.' + v);
  if (k === 'delayMinutes') return t('rssx.minutes', { n: fmtNumber(Number(v)) });
  return String(v);
}

function Row({ label, hint, note, source, isLast, children, testId }: { label: string; hint?: string; note?: React.ReactNode; source?: string; isLast?: boolean; children: React.ReactNode; testId: string }) {
  return (
    <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: isLast ? 'none' : '1px solid var(--line)' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}{source ? <span className={'chip ' + (source === 'default' ? '' : 'gold')} style={{ marginLeft: 8 }} data-testid={`${testId}-src`}>{t('rssx.src.' + source)}</span> : null}</div>
        {hint ? <div className="sub" style={{ marginTop: 4, lineHeight: 1.4 }}>{hint}</div> : null}
        {note ? <div className="sub warn" style={{ marginTop: 4, lineHeight: 1.4 }} data-testid={`${testId}-note`}>{note}</div> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}
const Section = ({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) => (
  <section className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }} data-testid={testId}>
    <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14 }}>{title}</div>{children}
  </section>);

export function POSAIReviewReputationSettingsScreen() {
  const can = useCan();
  const manage = can('pos.ai_review_reputation.manage');
  const [s, setS] = useState<any>(null);
  const [draft, setDraft] = useState<Vals | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'settings' | 'history' | 'health'>('settings');
  const [confirming, setConfirming] = useState(false);
  const saved = (st: any): Vals => Object.fromEntries(st.settings.map((x: any) => [x.key, x.value])) as Vals;
  const load = useCallback(async () => {
    setErr(null);
    try { const st = await api.state(); setS(st); setDraft(saved(st)); } catch (e) { setErr(errText(e, 'rssx.loadFailed')); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const base = s ? saved(s) : null;
  const changes = draft && base ? KEYS.filter((k) => draft[k] !== base[k]) : [];
  const dirty = changes.length > 0;
  const conflict = !!draft && draft.autoResponse === true && draft.approvalRequired !== false;
  const delayBad = !!draft && (!Number.isInteger(Number(draft.delayMinutes)) || Number(draft.delayMinutes) < 0 || Number(draft.delayMinutes) > 10080);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const set = (k: Key, v: unknown) => { setNotice(null); setDraft((d) => ({ ...(d as Vals), [k]: v })); };
  const src = (k: Key) => s?.settings.find((x: any) => x.key === k)?.source as string | undefined;
  const a = s?.assistant; const e = s?.entitlement; const rt = s?.runtime;

  return (
    <div className="work rvw rssx" data-testid="reputation-settings-screen">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div><h1>{t('pos.review_reputation_settings')}</h1><div className="sub mb-3">{t('pos.control_how_the_assistant_analyzes_reviews_sow4')}</div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {dirty ? <span className="chip warn" data-testid="rssx-dirty">{t('rssx.unsaved', { n: fmtNumber(changes.length) })}</span> : null}
          {dirty ? <button className="btn ghost" data-testid="rssx-discard" onClick={() => base && setDraft(base)}>{t('rssx.discard')}</button> : null}
          {manage ? <button className="btn w-fit whitespace-nowrap" data-testid="rssx-save" disabled={!dirty || conflict || delayBad} onClick={() => setConfirming(true)} style={{ height: 34, padding: '0 16px', fontSize: 13 }}>{t('pos.save_changes')}</button>
            : <span className="sub">{t('rssx.notAllowed')}</span>}
        </div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="rssx-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      {!s && !err ? <div className="state">{t('rssx.loading')}</div> : null}
      {s && draft ? <>
        <div className="rvw-kpis" data-testid="rssx-strip" style={{ marginBottom: 12 }}>
          <div className="kpi" data-testid="rssx-effective"><div className="l">{t('rssx.strip.effective')}</div><div className="v" style={{ fontSize: 15 }}>{t('rssx.op.' + a.operational)}</div>
            {a.disabledAtLevel ? <div className="sub">{t('rssx.disabledAt', { l: t('rssx.level.' + a.disabledAtLevel) })}</div> : null}
            {a.branchOverride === 'disabled' ? <div className="sub">{t('rssx.branchOff')}</div> : null}</div>
          <div className="kpi" data-testid="rssx-package"><div className="l">{t('rssx.strip.package')}</div><div className="v" style={{ fontSize: 15 }}>{t('rssx.ent.' + e.reason)}</div><div className="sub">{t('rssx.mode.' + e.enforcement)}</div></div>
          <div className="kpi" data-testid="rssx-sms"><div className="l">{t('rssx.strip.sms')}</div><div className="v" style={{ fontSize: 15 }}>{s.sms.configured ? t('rssx.sms.configured') : t('rssx.sms.notConfigured')}</div>
            {s.sms.lastError ? <div className="sub warn">{t('rssx.sms.validationFailed')}</div> : null}</div>
          <div className="kpi" data-testid="rssx-providers"><div className="l">{t('rssx.strip.providers')}</div><div className="v" style={{ fontSize: 15 }}>{s.providers.connected ? t('rssx.providers.n', { n: fmtNumber(s.providers.connected) }) : t('rssx.providers.none')}</div>
            {s.providers.connected ? <div className="sub" data-testid="rssx-provider-sync">{s.providers.lastSuccessfulSyncAt ? t('rssx.fresh.lastSync', { at: when(s.providers.lastSuccessfulSyncAt) }) : t('rssx.fresh.neverSynced')}</div> : null}
            {s.providers.failing ? <div className="sub warn" data-testid="rssx-provider-failing">{t('rssx.fresh.failing', { n: fmtNumber(s.providers.failing) })}</div> : null}</div>
        </div>
        {s.publishQueue && (s.publishQueue.approvedNotPublished || s.publishQueue.publishFailed || rt.reviewRequests.overdueNotSent) ? <div className="panel" role="status" data-testid="rssx-risks" style={{ padding: 10, marginBottom: 10 }}>
          {s.publishQueue.approvedNotPublished ? <div>{t('rssx.fresh.waiting', { n: fmtNumber(s.publishQueue.approvedNotPublished) })}</div> : null}
          {s.publishQueue.publishFailed ? <div className="warn">{t('rssx.fresh.publishFailed', { n: fmtNumber(s.publishQueue.publishFailed) })}</div> : null}
          {rt.reviewRequests.overdueNotSent ? <div className="warn">{t('rssx.fresh.overdue', { n: fmtNumber(rt.reviewRequests.overdueNotSent) })}</div> : null}
        </div> : null}

        {s.providerInventory ? <ProviderInventory inv={s.providerInventory} when={when} /> : null}

        <div className="rvw-tabs" role="tablist" data-testid="rssx-tabs">
          {(['settings', 'history', 'health'] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={'btn ghost' + (tab === x ? ' on' : '')} data-testid={`tab-${x}`} onClick={() => setTab(x)}>{t('rssx.tab.' + x)}</button>)}
        </div>

        {tab === 'settings' ? <div data-testid="rssx-settings" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: 20, alignItems: 'start' }}>
          <div>
            <Section title={t('pos.assistant')} testId="rssx-sec-assistant">
              <Row testId="row-enabled" label={t(LABEL.enabled)} hint={t('pos.turns_analysis_drafting_and_requests_on_aerb')} source={src('enabled')}>
                <input type="checkbox" data-testid="in-enabled" disabled={!manage} checked={!!draft.enabled} onChange={(ev) => set('enabled', ev.target.checked)} style={{ width: 18, height: 18 }} />
              </Row>
              <Row testId="row-responseTone" label={t(LABEL.responseTone)} hint={t('rssx.toneHint')} source={src('responseTone')}>
                <select className="in" data-testid="in-responseTone" disabled={!manage} value={draft.responseTone} onChange={(ev) => set('responseTone', ev.target.value)} style={{ minWidth: 160 }}>
                  {TONES.map((x) => <option key={x} value={x}>{t('rssx.tone.' + x)}</option>)}
                </select>
              </Row>
              <Row testId="row-approvalRequired" label={t(LABEL.approvalRequired)} hint={t('pos.recommended_public_responses_wait_for_a_km03')} source={src('approvalRequired')} isLast
                note={rt.approval === 'always_enforced' ? t('rssx.rt.approval') : undefined}>
                <input type="checkbox" data-testid="in-approvalRequired" disabled={!manage} checked={draft.approvalRequired !== false} onChange={(ev) => set('approvalRequired', ev.target.checked)} style={{ width: 18, height: 18 }} />
              </Row>
            </Section>
            <Section title={t('pos.controlled_auto_response')} testId="rssx-sec-auto">
              <div className="sub" style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', lineHeight: 1.5 }}>{t('pos.off_by_default_when_on_the_fnkg')}</div>
              <Row testId="row-autoResponse" label={t(LABEL.autoResponse)} source={src('autoResponse')} isLast
                note={conflict ? t('rssx.conflict') : draft.autoResponse ? t('rssx.rt.autoResponse') : undefined}>
                <input type="checkbox" data-testid="in-autoResponse" disabled={!manage} checked={!!draft.autoResponse} onChange={(ev) => set('autoResponse', ev.target.checked)} style={{ width: 18, height: 18 }} />
              </Row>
            </Section>
          </div>
          <div>
            <Section title={t('pos.post_visit_review_requests')} testId="rssx-sec-requests">
              <Row testId="row-requestsEnabled" label={t(LABEL.requestsEnabled)} hint={t('pos.fair_to_all_customers_never_gates_1pyz')} source={src('requestsEnabled')}
                note={draft.requestsEnabled ? t('rssx.rt.requests', { n: fmtNumber(rt.reviewRequests.scheduled), o: fmtNumber(rt.reviewRequests.overdueNotSent) }) : undefined}>
                <input type="checkbox" data-testid="in-requestsEnabled" disabled={!manage} checked={!!draft.requestsEnabled} onChange={(ev) => set('requestsEnabled', ev.target.checked)} style={{ width: 18, height: 18 }} />
              </Row>
              <Row testId="row-channel" label={t(LABEL.channel)} source={src('channel')} note={draft.channel === 'sms' && draft.requestsEnabled && !s.sms.configured ? t('rssx.smsMissing') : undefined}>
                <select className="in" data-testid="in-channel" disabled={!manage} value={draft.channel} onChange={(ev) => set('channel', ev.target.value)} style={{ minWidth: 140 }}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{t('rssx.chan.' + c)}</option>)}
                </select>
              </Row>
              <Row testId="row-delayMinutes" label={t(LABEL.delayMinutes)} hint={t('rssx.delayHint', { s: fmtNumber(s.safeguards.quietHoursStart), e: fmtNumber(s.safeguards.quietHoursEnd) })} source={src('delayMinutes')}
                note={delayBad ? t('rssx.delayBad') : undefined}>
                <input type="number" inputMode="numeric" className="in" data-testid="in-delayMinutes" disabled={!manage} min={0} max={10080} value={draft.delayMinutes}
                  onChange={(ev) => set('delayMinutes', ev.target.value === '' ? '' : Number(ev.target.value))} style={{ width: 90, textAlign: 'center' }} />
              </Row>
              <Row testId="row-oneReminder" label={t(LABEL.oneReminder)} hint={t('pos.at_most_one_follow_up_if_1r8m')} source={src('oneReminder')} isLast
                note={draft.oneReminder ? t('rssx.rt.reminder') : undefined}>
                <input type="checkbox" data-testid="in-oneReminder" disabled={!manage} checked={!!draft.oneReminder} onChange={(ev) => set('oneReminder', ev.target.checked)} style={{ width: 18, height: 18 }} />
              </Row>
            </Section>
            <section className="panel" style={{ padding: 16 }} data-testid="rssx-safeguards">
              <div className="p-h">{t('rssx.safeguards')}</div>
              <ul className="sub">
                <li>{t('rssx.sg.quiet', { s: fmtNumber(s.safeguards.quietHoursStart), e: fmtNumber(s.safeguards.quietHoursEnd) })}</li>
                <li>{t('rssx.sg.cooldown', { n: fmtNumber(s.safeguards.cooldownDays) })}</li>
                <li>{t('rssx.sg.max', { n: fmtNumber(s.safeguards.maxPerCustomerPerPeriod) })}</li>
                <li>{t('rssx.sg.consent')}</li>
              </ul>
              <p className="sub" data-testid="rssx-last">{s.lastChange ? t('rssx.lastChange', { at: when(s.lastChange.at), by: s.lastChange.by ?? '—', v: fmtNumber(s.salonRow.version) }) : t('rssx.noChange')}</p>
              <p className="sub">{t('rssx.liveNote')}</p>
            </section>
          </div>
        </div>
          : tab === 'history' ? <HistoryTab />
          : <HealthTab />}
      </> : null}

      {confirming && s && draft && base ? <ConfirmSave base={base} draft={draft} changes={changes} version={s.salonRow.version} onClose={() => setConfirming(false)}
        onDone={(r) => { setConfirming(false); setS(r.state); setDraft(saved(r.state)); setNotice(t('rssx.saved', { v: fmtNumber(r.version) })); }}
        onStale={() => { setConfirming(false); setNotice(t('rssx.err.RSS_STALE_VERSION')); void load(); }} /> : null}
    </div>
  );
}

function ConfirmSave({ base, draft, changes, version, onClose, onDone, onStale }: { base: Vals; draft: Vals; changes: Key[]; version: number; onClose: () => void; onDone: (r: any) => void; onStale: () => void }) {
  const { principal } = useAuth();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    const values = Object.fromEntries(changes.map((k) => [k, k === 'delayMinutes' ? Number(draft[k]) : draft[k]])) as ReputationSettingsValues;
    try { onDone(await api.save({ values, expectedVersion: version, reason: reason.trim() || undefined })); }
    catch (e: any) { if ((e?.body?.code ?? e?.code) === 'RSS_STALE_VERSION') { onStale(); return; } setErr(errText(e, 'rssx.saveFailed')); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog testId="rssx-confirm" busy={busy} title={t('rssx.confirmTitle')} onClose={onClose}
      footer={<div className="rvw-ov-foot"><button className="btn ghost" onClick={onClose} disabled={busy}>{t('rssx.cancel')}</button>
        <button className="btn" data-testid="rssx-confirm-go" disabled={busy} onClick={() => void go()}>{busy ? t('pos.saving_2') : t('pos.save_changes')}</button></div>}>
      <p>{t('rssx.confirmIntro')}</p>
      <ul data-testid="rssx-confirm-list">{changes.map((k) => <li key={k}><b>{t(LABEL[k])}</b>: {valueText(k, base[k])} → {valueText(k, k === 'delayMinutes' ? Number(draft[k]) : draft[k])}</li>)}</ul>
      {principal?.role ? <p className="sub">{t('rssx.confirmRole', { role: statusLabel('role', principal.role) })}</p> : null}
      <p className="sub">{t('rssx.scopeNote')}</p>
      <label className="rvw-f"><span>{t('rssx.reason')}</span><textarea data-testid="rssx-reason" maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} /></label>
      {err ? <p className="err" role="alert" data-testid="rssx-confirm-err">{err}</p> : null}
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
  useEffect(() => { setErr(null); api.history(f).then(setD).catch((e) => setErr(errText(e, 'rssx.loadFailed'))); }, [f]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const any = !!(f.q || f.type || f.preset);
  return (
    <section className="panel rvw-feed" data-testid="rssx-history">
      <form className="rvw-filters" onSubmit={(ev) => { ev.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="rssx-hist-search" value={draft} onChange={(ev) => setDraft(ev.target.value)} placeholder={t('rssx.searchHistory')} aria-label={t('rssx.searchHistory')} />
        <button className="btn" type="submit">{t('rssx.search')}</button>
        <select data-testid="rssx-hist-type" value={f.type ?? ''} onChange={(ev) => set({ type: ev.target.value || undefined })}>
          <option value="">{t('rssx.anyType')}</option>{EVENT_TYPES.map((x) => <option key={x} value={x}>{t('rssx.event.' + x)}</option>)}
        </select>
        {any ? <button className="btn ghost" type="button" data-testid="rssx-hist-clear" onClick={() => { setDraft(''); setF({ page: 1, pageSize: f.pageSize }); }}>{t('rssx.clear')}</button> : null}
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!f.preset ? ' on' : '')} onClick={() => set({ preset: undefined, from: undefined, to: undefined })}>{t('rssx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`hist-preset-${p}`} onClick={() => set({ preset: p, from: undefined, to: undefined })}>{t('rssx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="hist-preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('rssx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={d?.period?.today ?? deviceToday()}
        onApply={(r) => { set({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { set({ preset: undefined, from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rssx.loading')}</div> : d.items.length === 0 ? <Empty title={any ? t('rssx.noMatch') : t('rssx.noHistory')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('rssx.hist.when')}</th><th>{t('rssx.hist.change')}</th><th>{t('rssx.hist.keys')}</th><th>{t('rssx.hist.by')}</th><th>{t('rssx.hist.version')}</th></tr></thead>
          <tbody>{d.items.map((r: any) => <tr key={r.id} data-testid="rssx-hist-row" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen(r.id); }}>
            <td className="nowrap">{when(r.at)}</td><td>{t('rssx.event.' + r.type)}{r.legacy ? <div className="sub">{t('rssx.legacy')}</div> : null}</td>
            <td>{r.changes.map((c: any) => t(LABEL[c.key as Key])).join(', ') || '—'}</td>
            <td>{r.actor ?? '—'}{r.role ? <div className="sub">{statusLabel('role', r.role)}</div> : null}</td><td className="num">{fmtNumber(r.version)}</td></tr>)}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('rssx.rows')}</span>
          <select value={String(f.pageSize)} onChange={(ev) => set({ pageSize: Number(ev.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      {open ? <EventOverlay id={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function EventOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.event(id).then(setD).catch((e) => setErr(errText(e, 'rssx.loadFailed'))); }, [id]);
  return (
    <FitDialog wide testId="rssx-event" title={t('rssx.ov.title')} subtitle={d ? `${t('rssx.event.' + d.type)} · ${when(d.at)}` : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('rssx.close')}</button>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rssx.loading')}</div> : <>
        <dl className="rvw-dl">
          <dt>{t('rssx.ov.id')}</dt><dd className="sub">{d.id}</dd>
          <dt>{t('rssx.hist.by')}</dt><dd>{d.actor ?? '—'}{d.role ? ` · ${statusLabel('role', d.role)}` : ''}</dd>
          <dt>{t('rssx.ov.scope')}</dt><dd>{t('rssx.level.' + d.level)}</dd>
          <dt>{t('rssx.hist.version')}</dt><dd>{fmtNumber(d.version)}</dd>
          {d.reason ? <><dt>{t('rssx.ov.reason')}</dt><dd>{d.reason}</dd></> : null}
        </dl>
        <table className="tbl w-full" data-testid="rssx-event-changes"><thead><tr><th>{t('rssx.hist.keys')}</th><th>{t('rssx.ov.before')}</th><th>{t('rssx.ov.after')}</th></tr></thead>
          <tbody>{d.changes.map((c: any) => <tr key={c.key}><td>{t(LABEL[c.key as Key])}</td><td>{c.beforeKnown ? (c.before === null ? t('rssx.ov.default') : valueText(c.key, c.before)) : t('rssx.unknown')}</td>
            <td>{c.after === null ? t('rssx.ov.default') : valueText(c.key, c.after)}</td></tr>)}</tbody></table>
        {d.legacy ? <p className="sub">{t('rssx.legacy')}</p> : null}
        <p className="sub" data-testid="rssx-event-propagation">{t('rssx.ov.live', { d: fmtNumber(d.propagation.aiDraftsSince), r: fmtNumber(d.propagation.requestsScheduledSince) })}</p>
      </>}
    </FitDialog>
  );
}

function HealthTab() {
  const [d, setD] = useState<any | 'loading' | null>(null);
  const run = () => { setD('loading'); api.check().then(setD).catch((e) => setD({ error: errText(e, 'rssx.loadFailed') })); };
  return (
    <section className="panel rvw-feed" data-testid="rssx-health">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="btn" data-testid="rssx-check" onClick={run}>{t('rssx.check')}</button><span className="sub">{t('rssx.health.intro')}</span></div>
      {d === null ? null : d === 'loading' ? <div className="state">{t('rssx.health.running')}</div> : d.error ? <div className="err">{d.error}</div> : <>
        <p className="sub" data-testid="rssx-health-overall">{t('rssx.health.overall', { s: t('rssx.health.' + d.overall), at: when(d.checkedAt) })}{d.reused ? ` ${t('rssx.health.recent')}` : ''}</p>
        {d.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('rssx.health.' + x.state)}</span> <b>{t('rssx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('rssx.health.d.' + x.key + '.' + x.state)}</div>
            {x.key === 'request_dry_run' && x.detail ? <DryRunLine d={x.detail} /> : null}
          </div>
        ))}
      </>}
    </section>
  );
}

/** Extras (Review & Reputation Settings 03): the server's dry run of the current request policy over the last 7 days of paid
 *  visits — counts and reasons only, worded here; nothing was scheduled or sent. */
type DryRunDetail = { days: number; visits: number; capped: boolean; wouldAsk: number; skipped: number; byReason: Record<string, number>; quietHoursShifted: number; channel: string; channelReady: boolean | null; requestsEnabled: boolean };
function DryRunLine({ d }: { d: DryRunDetail }) {
  const reasons = Object.entries(d.byReason).filter(([, n]) => n > 0).map(([r, n]) => `${codeLabel('rssx.dry.r.' + r, r)} ${fmtNumber(n)}`).join(' · ');
  return <div className="sub" data-testid="rssx-dry-run">
    <div>{t('rssx.dry.line', { days: fmtNumber(d.days), v: fmtNumber(d.visits) + (d.capped ? '+' : ''), a: fmtNumber(d.wouldAsk), s: fmtNumber(d.skipped) })}{reasons ? ` (${reasons})` : ''}</div>
    <div>{t('rssx.dry.quiet', { n: fmtNumber(d.quietHoursShifted) })} {t('rssx.dry.channel', { c: codeLabel('rssx.dry.ch.' + d.channel, d.channel) })}{d.channelReady === false ? ' ' + t('rssx.dry.notReady') : ''}</div>
    {!d.requestsEnabled ? <div>{t('rssx.dry.off')}</div> : null}
  </div>;
}

/** Review Reputation 08 — the server's inventory of review sites (what is connected, what the code can really do) + own feedback */
function ProviderInventory({ inv, when }: { inv: any; when: (iso: string | null | undefined) => string }) {
  return (
    <section className="panel" style={{ padding: 12, marginBottom: 10 }} data-testid="rssx-inv">
      <div className="p-h">{t('rssx.inv.title')}</div>
      <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>{t('rssx.inv.site')}</th><th>{t('rssx.inv.connection')}</th><th>{t('rssx.inv.sync')}</th>
        <th>{t('rssx.inv.replies')}</th><th>{t('rssx.inv.import')}</th><th className="num">{t('rssx.inv.reviews')}</th></tr></thead>
        <tbody>{inv.external.map((x: any) => <tr key={x.source} data-testid={`rssx-inv-${x.source}`}>
          <td>{t('rssx.inv.src.' + x.source)}</td><td>{t('rssx.inv.conn.' + x.connector)}</td>
          <td>{x.lastSuccessfulSyncAt ? when(x.lastSuccessfulSyncAt) : '—'}{x.lastFailedSyncAt ? <div className="sub warn">{t('rssx.inv.failedAt', { at: when(x.lastFailedSyncAt) })}</div> : null}</td>
          <td>{x.replyByApi ? t('rssx.inv.replyApi') : t('rssx.inv.replyManual')}</td><td>{x.autoImport ? t('rssx.inv.importOn') : t('rssx.inv.importOff')}</td>
          <td className="num">{fmtNumber(x.reviews)}</td></tr>)}</tbody></table></div>
      <p className="sub" data-testid="rssx-inv-internal">{t('rssx.inv.internal', { n: fmtNumber(inv.internal.reviews), r: fmtNumber(inv.internal.requestsSent) })}</p>
      <p className="sub">{t('rssx.inv.note')}</p>
    </section>
  );
}
