// POSAIVoiceTranscriptionSettingsScreen.tsx — AI Center → AI Voice Transcription → Settings. Wired to
// GET/PUT /pos/ai-voice-transcription/settings (view / manage_settings). Controls the tenant transcription policy:
// master enable, retention window, raw (pre-redaction) retention, and consent-announcement version. Redaction
// itself is always on and is intentionally not a toggle.
//
// Voice Transcription Settings guide (Nov 2 2026):
//   • a save sends only the changed fields + the version it read; a stale save is refused and the latest values are shown;
//   • a SENSITIVE change (shorter retention, raw text on / off, transcription off) is confirmed in a dialog that says what it
//     does to stored calls (how many become due for deletion, how much raw text is purged) — the server refuses it without;
//   • the status row says what is really happening (last processed call, redaction backlog, overdue deletions, provider
//     confirmations, which announcement versions calls actually played) instead of echoing the form;
//   • Records (settings changes · deletions · processing failures · raw-text views) with search, presets + month calendar,
//     numbered pages; Check Voice Transcription Settings (read-only). No customer transcript search here — that is Voice Search.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { statusLabel } from '../i18n/status-label';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const api = posAIVoiceTranscriptionApi;
type Settings = { transcriptionEnabled: boolean; retentionDays: number; retainRaw: boolean; consentAnnouncementVersion: string | null; version?: number; updatedAt?: string | null; saved?: boolean };
const FIELDS = ['transcriptionEnabled', 'retentionDays', 'retainRaw', 'consentAnnouncementVersion'] as const;
const KINDS = ['all', 'settings', 'deletion', 'failure', 'raw_access'] as const;
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year'] as const;
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const codeOf = (e: unknown) => { const x = e as { body?: { code?: string; impact?: unknown }; code?: string; details?: { code?: string } } | null; return x?.body?.code ?? x?.details?.code ?? x?.code; };
const impactOf = (e: unknown) => { const x = e as { body?: { impact?: any }; details?: { impact?: any; error?: { impact?: any; details?: { impact?: any } } } } | null;
  return x?.details?.impact ?? x?.details?.error?.impact ?? x?.details?.error?.details?.impact ?? x?.body?.impact ?? null; };
type Period = { preset?: string; from?: string; to?: string };

export function POSAIVoiceTranscriptionSettingsScreen() {
  const [base, setBase] = useState<Settings | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<{ impact: any; patch: Record<string, unknown> } | null>(null);
  const [sum, setSum] = useState<any>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [tick, setTick] = useState(0);

  const loadSum = useCallback(() => { api.center.summary().then(setSum).catch(() => setSum(null)); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const d = await api.getSettings() as Settings; setBase(d); setS(d); }
    catch (e: any) { setError(isForbidden(e) ? t('vsx.err.forbidden') : reportError(e, tx('growth.noun.settings'))); }
    finally { setLoading(false); }
    loadSum();
  }, [loadSum]);
  useEffect(() => { load(); }, [load]);

  const changed = s && base ? FIELDS.filter((k) => s[k] !== base[k]) : [];
  const send = async (patch: Record<string, unknown>, confirmed: boolean) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const d = await api.updateSettings({ ...patch, expectedVersion: base?.version ?? 0, ...(confirmed ? { confirm: true } : {}) }) as Settings;
      setBase(d); setS(d); setNotice(tx('growth.common.settingsSaved')); setConfirm(null); setTick((n) => n + 1); loadSum();
    } catch (e: any) {
      const code = codeOf(e);
      if (code === 'VT_CONFIRM_REQUIRED') { setConfirm({ impact: impactOf(e) ?? { sensitive: [] }, patch }); }
      else if (code === 'VT_SETTINGS_VERSION_CONFLICT') {
        setError(t('vsx.err.conflict')); setConfirm(null);
        api.getSettings().then((d: any) => { setBase(d); setS(d); }).catch(() => undefined);
      } else { setConfirm(null); setError(isForbidden(e) ? t('vsx.err.forbidden') : reportError(e, tx('growth.noun.settings'))); }
    } finally { setSaving(false); }
  };
  const save = () => {
    if (!s) return;
    if (!Number.isInteger(s.retentionDays) || s.retentionDays < 1 || s.retentionDays > 3650) { setError(tx('pos.retention_must_be_between_1_and_1l4y')); return; }
    if (!changed.length) { setNotice(t('vsx.nothingChanged')); return; }
    send(Object.fromEntries(changed.map((k) => [k, s[k]])), false);
  };
  const runCheck = () => { setHealth('loading'); api.center.check().then((d) => { setHealth(d); loadSum(); }).catch((e) => setHealth({ error: isForbidden(e) ? t('vsx.err.forbidden') : errorTextOf(e, t('vsx.loadFailed')) })); };

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_settings')}</div></div>;
  if (!s) return <div className="work"><div className="vh"><h1>{tx('pos.voice_transcription_settings')}</h1></div><ErrorRetry message={error ?? tx('pos.no_settings')} onRetry={load} /></div>;
  const tr = sum?.transcription; const rt = sum?.retention; const rd = sum?.redaction; const raw = sum?.raw; const cons = sum?.consent;

  return (
    <div className="work" data-testid="vsx-page">
      <div className="vh" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1>{tx('pos.voice_transcription_settings')}</h1>
          <div className="sub mb-3">{tx('pos.tenant_transcription_policy_sensitive_data_redaction_kd83')}</div>
        </div>
        <button className="btn ghost" data-testid="vsx-check" onClick={runCheck}>{t('vsx.check')}</button>
      </div>

      {sum ? <div className="rvw-kpis" data-testid="vsx-kpis" style={{ marginBottom: 12 }}>
        <KpiCard testId="vsx-kpi-tx" label={t('vsx.kpi.transcription')} value={t('vsx.tx.' + (tr?.state ?? 'unknown'))} tone={tr?.state === 'on' ? 'ok' : tr?.state === 'off' ? 'warn' : 'bad'}
          sub={tr?.lastProcessedAt ? t('vsx.lastProcessed', { at: when(tr.lastProcessedAt) }) : t('vsx.noneProcessed')} />
        <KpiCard testId="vsx-kpi-redaction" label={t('vsx.kpi.redaction')} value={t('vsx.alwaysOn')} tone={rd?.failed ? 'bad' : rd?.stuck ? 'warn' : 'ok'}
          sub={rd?.failed || rd?.stuck ? t('vsx.redactionIssues', { failed: rd.failed, stuck: rd.stuck }) : undefined} />
        <KpiCard testId="vsx-kpi-retention" label={t('vsx.kpi.retention')} value={rt?.days != null ? t('vsx.days', { n: rt.days }) : '—'} tone={rt?.overdue ? 'bad' : undefined}
          sub={rt?.overdue ? t('vsx.overdue', { n: rt.overdue }) : rt?.nextDueAt ? t('vsx.nextDue', { at: when(rt.nextDueAt) }) : undefined} />
        <KpiCard testId="vsx-kpi-raw" label={t('vsx.kpi.raw')} value={raw?.retain == null ? '—' : t(raw.retain ? 'vsx.on' : 'vsx.off')} tone={raw?.retain ? 'warn' : undefined}
          sub={raw?.stored ? t('vsx.rawStored', { n: raw.stored }) : undefined} />
      </div> : null}

      {error && <div className="err" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {notice && <div className="ok" role="status" style={{ marginBottom: 10 }}>{notice}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div className="panel" style={{ flex: '1 1 420px', maxWidth: 640 }} data-testid="vsx-form">
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0', minHeight: 44 }}>
            <input type="checkbox" checked={s.transcriptionEnabled} onChange={(e) => setS({ ...s, transcriptionEnabled: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span><strong>{tx('pos.transcription_enabled')}</strong><div className="sub">{tx('pos.when_off_new_calls_are_not_bwws')}</div></span>
          </label>

          <div style={{ padding: '8px 0' }} data-testid="vsx-redaction">
            <strong>{t('vsx.kpi.redaction')}</strong> <span className="chip ok">{t('vsx.alwaysOn')}</span>
            <div className="sub">{t('vsx.redactionNote')}</div>
          </div>

          <label style={{ display: 'block', padding: '8px 0' }}>
            <strong>{tx('pos.retention_window_days')}</strong>
            <div className="sub">{tx('pos.transcripts_are_automatically_erased_store_and_z489')}</div>
            <input type="number" min={1} max={3650} step={1} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: +e.target.value })} style={{ width: 120, marginTop: 4 }} aria-label={tx('pos.retention_window_days')} />
          </label>

          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0', minHeight: 44 }}>
            <input type="checkbox" checked={s.retainRaw} onChange={(e) => setS({ ...s, retainRaw: e.target.checked })} style={{ width: 18, height: 18 }} />
            <span><strong>{tx('pos.retain_raw_pre_redaction_text')}</strong><div className="sub">{tx('pos.off_by_default_when_on_raw_jmsy')}</div></span>
          </label>

          <label style={{ display: 'block', padding: '8px 0' }}>
            <strong>{tx('pos.consent_announcement_version')}</strong>
            <div className="sub">{tx('pos.identifier_for_the_recorded_consent_announcement_15nn')}</div>
            <input type="text" value={s.consentAnnouncementVersion ?? ''} onChange={(e) => setS({ ...s, consentAnnouncementVersion: e.target.value || null })} placeholder={tx('admin.form.example', { value: 'v1' })} style={{ width: 200, marginTop: 4 }} aria-label={tx('pos.consent_announcement_version')} />
            <div className="sub">{t('vsx.consentNote')}</div>
          </label>

          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <button type="button" onClick={save} disabled={saving} data-testid="vsx-save">{saving ? tx('pos.saving_2') : tx('pos.save_settings')}</button>
            {changed.length ? <span className="sub" data-testid="vsx-unsaved">{t('vsx.unsaved', { n: changed.length })}</span> : null}
            <span className="sub" data-testid="vsx-version">{base?.saved ? t('vsx.savedVersion', { v: base.version ?? 0, at: when(base.updatedAt) }) : t('vsx.defaults')}</span>
          </div>
        </div>

        {sum ? <div className="panel" style={{ flex: '1 1 320px' }} data-testid="vsx-status">
          <h4 style={{ marginTop: 0 }}>{t('vsx.st.title')}</h4>
          {sum.entitled === false ? <p className="err">{t('vsx.subRestricted')}</p> : null}
          <p className="sub">{t('vsx.st.calls', { calls: tr?.last30d?.calls ?? 0, ok: tr?.last30d?.transcribed ?? 0, consent: tr?.last30d?.consentBlocked ?? 0, failed: tr?.last30d?.failed ?? 0 })}</p>
          <p className="sub">{t('vsx.st.deletions', { n: rt?.deleted30d ?? 0, unconfirmed: rt?.providerUnconfirmed30d ?? 0, at: when(rt?.lastDeletionAt) })}</p>
          <p className="sub">{t('vsx.st.holds', { n: rt?.legalHolds ?? 0 })}</p>
          {rt && !rt.sweepArmedHere ? <p className="sub">{t('vsx.st.sweepNotHere')}</p> : null}
          <div data-testid="vsx-consent">
            <strong>{t('vsx.st.consentUsed')}</strong>
            {(cons?.used30d ?? []).length === 0 ? <p className="sub">{t('vsx.st.noConsent')}</p> : <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              {cons.used30d.map((v: any, i: number) => <li key={i}>{v.version ?? t('vsx.st.noVersion')} · {fmtNumber(v.calls)}</li>)}</ul>}
            {cons?.mismatched30d ? <p className="err" role="status">{t('vsx.st.mismatch', { n: cons.mismatched30d, v: cons.configured ?? '—' })}</p> : null}
          </div>
          <p className="sub" style={{ marginTop: 8 }}>
            <Link to="/tenant/ai/voice-transcription/history">{t('vsx.link.history')}</Link>{' · '}
            <Link to="/tenant/ai/voice-transcription/search">{t('vsx.link.search')}</Link>{' · '}
            <Link to="/tenant/ai/voice-transcription/unresolved">{t('vsx.link.followups')}</Link>
          </p>
        </div> : null}
      </div>

      <RecordsCard tick={tick} />

      {confirm ? <FitDialog testId="vsx-confirm" title={t('vsx.confirm.title')} onClose={() => setConfirm(null)} busy={saving}
        footer={<><button className="btn ghost" onClick={() => setConfirm(null)}>{t('vsx.cancel')}</button>
          <button className="btn" data-testid="vsx-confirm-yes" disabled={saving} onClick={() => send(confirm.patch, true)}>{t('vsx.confirm.yes')}</button></>}>
        <ul data-testid="vsx-impact">
          {(confirm.impact.sensitive ?? []).map((k: string) => <li key={k}>{t('vsx.confirm.' + k, { transcripts: confirm.impact.transcripts ?? 0, due: confirm.impact.dueNow ?? 0, raw: confirm.impact.rawToPurge ?? 0 })}</li>)}
        </ul>
        <p className="sub">{t('vsx.confirm.note')}</p>
      </FitDialog> : null}

      {health ? <FitDialog wide testId="vsx-health" title={t('vsx.check')} onClose={() => setHealth(null)}
        subtitle={health !== 'loading' && !health.error ? t('vsx.health.overall', { s: t('vsx.health.' + health.overall), at: when(health.checkedAt) }) : undefined}
        footer={<button className="btn ghost" onClick={() => setHealth(null)}>{t('vsx.close')}</button>}>
        {health === 'loading' ? <div className="state">{t('vsx.health.running')}</div> : health.error ? <div className="err">{health.error}</div> : <>
          <p className="sub">{t('vsx.health.readOnly')}{health.reused ? ` ${t('vsx.health.recent')}` : ''}</p>
          {(health.checks ?? []).map((x: any) => (
            <div key={x.key} className="rvw-check" data-testid={`vsx-chk-${x.key}`}>
              <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')}>{t('vsx.health.' + x.state)}</span> <b>{t('vsx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
              <div className="sub">{t('vsx.health.d.' + x.key + '.' + x.state)}</div>
            </div>
          ))}
        </>}
      </FitDialog> : null}
    </div>
  );
}

const valueText = (key: string, v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'boolean' ? t(v ? 'vsx.on' : 'vsx.off') : key === 'retentionDays' ? t('vsx.days', { n: Number(v) }) : String(v));
function RecordsCard({ tick }: { tick: number }) {
  const [draft, setDraft] = useState('');
  const [f, setF] = useState<{ q?: string; kind: string; page: number; pageSize: number }>({ kind: 'all', page: 1, pageSize: 25 });
  const [period, setPeriod] = useState<Period>({});
  const [cal, setCal] = useState(false);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setErr(null);
    api.center.records({ ...f, ...period, q: f.q }).then(setList).catch((e) => setErr(codeOf(e) === 'VC_INVALID_PERIOD' ? t('vsx.err.period') : isForbidden(e) ? t('vsx.err.forbidden') : errorTextOf(e, t('vsx.loadFailed'))));
  }, [f, period]);
  useEffect(() => { load(); }, [load, tick]);
  const set = (p: Partial<typeof f>, keepPage = false) => setF((x) => ({ ...x, ...p, page: keepPage ? (p.page ?? x.page) : 1 }));
  const setPer = (p: Period) => { setPeriod(p); setF((x) => ({ ...x, page: 1 })); };
  const items: any[] = Array.isArray(list?.items) ? list.items : [];
  return (
    <section className="panel rvw-feed" data-testid="vsx-records" style={{ padding: 12, marginTop: 16 }}>
      <div className="p-h">{t('vsx.records')} <span className="sub">· {t('vsx.newestFirst')}{list ? ` · ${fmtNumber(list.total)}` : ''}</span></div>
      <form className="rvw-filters" onSubmit={(e) => { e.preventDefault(); set({ q: draft.trim() || undefined }); }}>
        <input className="rvw-search" data-testid="vsx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('vsx.searchPh')} aria-label={t('vsx.searchPh')} />
        <button className="btn" type="submit">{t('vsx.search')}</button>
        <select data-testid="vsx-kind" aria-label={t('vsx.kindLabel')} value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t('vsx.kind.' + k)}</option>)}</select>
      </form>
      <div className="rvw-dates">
        <button className={'btn ghost' + (!period.preset ? ' on' : '')} onClick={() => setPer({})}>{t('vsx.preset.all')}</button>
        {PRESETS.map((p) => <button key={p} className={'btn ghost' + (period.preset === p ? ' on' : '')} data-testid={`vsx-preset-${p}`} onClick={() => setPer({ preset: p })}>{t('vsx.preset.' + p)}</button>)}
        <button className={'btn ghost' + (period.preset === 'custom' ? ' on' : '')} onClick={() => setCal(true)}>{period.preset === 'custom' ? `${period.from} → ${period.to}` : t('vsx.preset.custom')}</button>
      </div>
      {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: period.from, to: period.to }} today={list?.period?.today ?? deviceToday()}
        onApply={(r) => { setPer({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setPer({}); setCal(false); }} /></div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !list ? <div className="state">{t('vsx.loading')}</div> : items.length === 0 ? <Empty title={t('vsx.noRecords')} /> : (
        <div className="rvw-table-wrap"><table className="tbl rvw-table"><thead><tr><th>{t('vsx.col.when')}</th><th>{t('vsx.col.kind')}</th><th>{t('vsx.col.what')}</th><th>{t('vsx.col.by')}</th></tr></thead>
          <tbody>{items.map((r) => (
            <tr key={`${r.kind}-${r.id}`} data-testid="vsx-row">
              <td className="nowrap">{when(r.at)}</td>
              <td><span className="chip">{t('vsx.kind.' + (KINDS.includes(r.kind) ? r.kind : 'all'))}</span></td>
              <td>{r.kind === 'settings' ? (r.changes ?? []).map((c: any) => <div key={c.key}><b>{t('vsx.key.' + c.key)}</b>: {valueText(c.key, c.before)} → {valueText(c.key, c.after)}</div>)
                : r.kind === 'deletion' ? <>{t('vsx.reason.' + (['retention_expired', 'tenant_request', 'customer_request', 'manual', 'admin'].includes(r.what) ? r.what : 'other'))}
                  <div className="sub">{t(r.providerConfirmed ? 'vsx.providerConfirmed' : 'vsx.providerNotConfirmed')}</div></>
                : r.kind === 'failure' ? t('vsx.fail.' + (['provider_error', 'failed', 'audio_unavailable', 'manual_review_required'].includes(r.what) ? r.what : 'failed')) : t('vsx.viewedRaw')}
                {r.transcriptId ? <div className="sub">#{String(r.transcriptId).slice(0, 8)}</div> : null}</td>
              <td>{r.kind === 'deletion' ? t(String(r.actor ?? '').startsWith('system') ? 'vsx.actor.system' : 'vsx.actor.staff') : (r.actor ?? '—')}{r.role ? <div className="sub">{statusLabel('role', r.role)}</div> : null}</td>
            </tr>))}</tbody></table></div>)}
      <div className="rvw-pager">
        <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => set({ page: p }, true)} />
        <label className="rvw-f"><span>{t('vsx.rows')}</span><select value={String(f.pageSize)} onChange={(e) => set({ pageSize: Number(e.target.value) })}>{['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
    </section>
  );
}
