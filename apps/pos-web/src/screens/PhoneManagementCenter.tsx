// PhoneManagementCenter.tsx — Customers › Phone Number Management (route /tenant/customers/phone-management).
// Phone Number Management Complete Build Guide (Oct 30 2026): one 27-inch work surface —
//   header (Update Phone · Check Verification Health · Refresh) · six KPI cards from the server, each with its source ·
//   Phone Settings (every original control, PhoneSettingsPanel) beside Verification & Synchronization Health ·
//   Pending & Recovery (soonest deadline first) · Phone Change History (newest first, PeriodBar + date basis) · Sync Monitor ·
//   numbered pages with 10 / 20 / 50 rows · the change overlay (trusted vs proposed, six-digit progress, notice, history, Close).
// Every change goes through the existing pos/customers/:customerId/phone/* routes (posCustomersApi.phone*), which own the state
// machine: nothing here can make an unverified number the trusted one. Re-entering the new number to send or check a code is
// deliberate — the list shows it masked, and the server checks the typed number matches the request.
// URL state: tab, status, source, method, shared, sync, preset/from/to, basis, page, size. The search text is never put in the URL.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posPhoneCenterApi as pcApi, type PcDetail, type PcHealth, type PcPage, type PcRow, type PcSummary, type PcCustomer } from '../api/posPhoneCenterApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtInZone, fmtNumber } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState } from '../components/FinanceKit';
import { PhoneSettingsPanel } from './POSCustomerPhoneSettingsScreen';

type Tab = 'pending' | 'history' | 'sync';
const GROUPS = ['pending', 'code_sent', 'retry_allowed', 'expired', 'failed', 'manager_review', 'cancelled', 'completed', 'sync_attention'] as const;
const SOURCES = ['staff_pos', 'customer_app', 'kiosk', 'ai_receptionist', 'import'] as const;
const BASES = ['requested', 'verified', 'applied', 'failed', 'audit'] as const;
const SYNCS = ['attention', 'retry_scheduled', 'failed', 'in_progress', 'pending', 'synced'] as const;
const isForbidden = (e: unknown) => { const x = e as { status?: number; code?: string } | null; return !!x && (x.status === 403 || x.code === 'PERMISSION_DENIED'); };
const errText = (e: unknown) => errorTextOf(e, tx('phm.loadError'));
const tone = (st: string): 'ok' | 'warn' | 'bad' | undefined => (st === 'ready' ? 'ok' : st === 'not_configured' || st === 'attention_required' ? 'bad' : st === 'unchecked' || st === 'pending' ? 'warn' : undefined);
const stTone: Record<string, string> = { completed: 'ok', code_sent: 'gold', pending: 'gold', retry_allowed: 'warn', manager_review: 'warn', expired: 'bad', failed: 'bad', sync_attention: 'bad', cancelled: '' };
function age(min: number | null) {
  if (min == null) return '—';
  if (min < 60) return tx('phm.minutes', { n: String(min) });
  if (min < 60 * 48) return tx('phm.hours', { n: String(Math.round(min / 60)) });
  return tx('phm.days', { n: String(Math.round(min / 1440)) });
}

export function PhoneManagementCenter() {
  const [sp, setSp] = useSearchParams();
  const tab = (['pending', 'history', 'sync'].includes(sp.get('tab') || '') ? sp.get('tab') : 'pending') as Tab;
  const page = Math.max(1, Number(sp.get('page') || 1) || 1);
  const size = [10, 20, 50].includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10;
  const f = { group: sp.get('status') || '', source: sp.get('source') || '', method: sp.get('method') || '', shared: sp.get('shared') || '', sync: sp.get('sync') || '', basis: sp.get('basis') || 'requested' };
  const period: PeriodState = { preset: (sp.get('preset') as PeriodState['preset']) || 'all', from: sp.get('from') || undefined, to: sp.get('to') || undefined };
  const setView = useCallback((patch: Record<string, string | number | null | undefined>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') next.delete(k); else next.set(k, String(v)); }
    if (!keepPage && !('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  }, [sp, setSp]);

  const [qText, setQText] = useState('');
  const q = useDebounced(qText.trim(), 300);
  useEffect(() => { if (page !== 1) setView({ page: null }); }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [summary, setSummary] = useState<PcSummary | null>(null);
  const [sumErr, setSumErr] = useState<unknown>(null);
  const [health, setHealth] = useState<PcHealth | null>(null);
  const [list, setList] = useState<PcPage<PcRow> | null>(null);
  const [listErr, setListErr] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const refresh = () => setReload((n) => n + 1);

  useEffect(() => {
    let live = true;
    pcApi.summary().then((s) => { if (live) { setSummary(s); setSumErr(null); } }, (e) => { if (live) setSumErr(e); });
    pcApi.health().then((h) => { if (live) setHealth(h); }, () => { if (live) setHealth(null); });
    return () => { live = false; };
  }, [reload]);

  const listKey = JSON.stringify({ tab, page, size, q, f, period });
  useEffect(() => {
    let live = true; setLoading(true);
    const base = { q: q || undefined, group: f.group || undefined, source: f.source || undefined, method: f.method || undefined, shared: f.shared || undefined, page, pageSize: size };
    const call = tab === 'history' ? pcApi.history({ ...base, sync: f.sync || undefined, basis: f.basis, ...periodQuery(period) })
      : tab === 'sync' ? pcApi.sync({ ...base, sync: f.sync || undefined })
      : pcApi.pending(base);
    call.then((r) => { if (live) { setList(r); setListErr(null); } }, (e) => { if (live) { setListErr(e); setList(null); } }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [listKey, reload]);   // eslint-disable-line react-hooks/exhaustive-deps

  const tz = summary?.timezone;
  const when = (iso: string | null | undefined) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '—');

  if (sumErr && isForbidden(sumErr)) return <div className="work"><div className="err" style={{ marginTop: 12 }} data-testid="pm-forbidden">{tx('phm.noPermission')}</div></div>;
  const k = summary?.kpis;
  const filtersOn = !!(q || f.group || f.source || f.method || f.shared || f.sync || period.preset !== 'all');

  return (
    <div className="work pm-page" data-testid="pm-page">
      <div className="pm-head">
        <div>
          <h1 className="pm-title">{tx('phm.title')}</h1>
          <div className="sub">{tx('phm.sub')}{summary ? ` · ${tx('phm.updated', { time: when(summary.generatedAt) })}` : ''}</div>
        </div>
        <div className="pm-actions">
          {summary?.can.startChange ? <button type="button" className="fk-btn" onClick={() => setUpdating(true)} data-testid="pm-update">{tx('phm.updatePhone')}</button> : null}
          <button type="button" className="fk-btn ghost" onClick={() => { refresh(); document.getElementById('pm-health')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }} data-testid="pm-check-health">{tx('phm.checkHealth')}</button>
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="pm-refresh">{tx('phm.refresh')}</button>
        </div>
      </div>

      {sumErr ? <ErrorRetry message={errText(sumErr)} onRetry={refresh} /> : null}
      <div className="pm-kpis" data-testid="pm-kpis">
        <KpiCard label={tx('phm.kpi.verified')} value={k ? fmtNumber(Number(k.verified.value)) : '…'} loading={!k} testId="pm-kpi-verified" />
        <KpiCard label={tx('phm.kpi.pending')} value={k ? fmtNumber(Number(k.pending.value)) : '…'} tone={k && Number(k.pending.value) > 0 ? 'gold' : undefined} onClick={() => setView({ tab: 'pending', status: null })} loading={!k} testId="pm-kpi-pending" />
        <KpiCard label={tx('phm.kpi.failed')} value={k ? fmtNumber(Number(k.failed.value)) : '…'} tone={k && Number(k.failed.value) > 0 ? 'warn' : undefined} onClick={() => setView({ tab: 'history', status: 'retry_allowed' })} loading={!k} testId="pm-kpi-failed" />
        <KpiCard label={tx('phm.kpi.today')} value={k ? fmtNumber(Number(k.today.value)) : '…'} onClick={() => setView({ tab: 'history', preset: 'today', status: 'completed', basis: 'audit' })} loading={!k} testId="pm-kpi-today" />
        <KpiCard label={tx('phm.kpi.shared')} value={k ? fmtNumber(Number(k.shared.value)) : '…'} loading={!k} testId="pm-kpi-shared" />
        <KpiCard label={tx('phm.kpi.smsHealth')} value={k ? tx('phm.state.' + String(k.smsHealth.value)) : '…'} tone={k ? tone(String(k.smsHealth.value)) : undefined} onClick={() => document.getElementById('pm-health')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })} loading={!k} testId="pm-kpi-sms" />
      </div>

      <div className="pm-mid">
        <section className="pm-card" aria-labelledby="pm-settings-h">
          <h2 id="pm-settings-h" className="pm-h2">{tx('phm.settings')}</h2>
          <PhoneSettingsPanel canEdit={summary ? summary.can.editSettings : false} />
        </section>
        <section className="pm-card" id="pm-health" aria-labelledby="pm-health-h" data-testid="pm-health">
          <h2 id="pm-health-h" className="pm-h2">{tx('phm.healthTitle')}</h2>
          {!health ? <div className="sub">{tx('pos.loading')}</div> : (
            <>
              <ul className="pm-health">
                {health.items.map((i) => (
                  <li key={i.key} className={'pm-h ' + (tone(i.state) ?? '')} data-testid={'pm-health-' + i.key}>
                    <span className="pm-h-l">{tx('phm.health.' + i.key)}</span>
                    <span className={'pm-chip ' + (tone(i.state) ?? '')}>{tx('phm.state.' + i.state)}</span>
                    <span className="pm-h-m">{i.message}</span>
                  </li>
                ))}
              </ul>
              <div className="sub" style={{ fontSize: 12, marginTop: 6 }}>{tx('phm.health.limits', { digits: String(health.limits.codeDigits), minutes: String(Math.round(health.limits.codeTtlSeconds / 60)), attempts: String(health.limits.maxAttempts), cooldown: String(health.limits.resendCooldownSeconds) })}</div>
            </>
          )}
        </section>
      </div>

      <section className="pm-card pm-lists" data-testid="pm-lists">
        <div className="fk-seg pm-tabs" role="tablist">
          {(['pending', 'history', 'sync'] as Tab[]).map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setView({ tab: x, status: null, sync: null })} data-testid={'pm-tab-' + x}>
              {tx('phm.tab.' + x)}{x === 'pending' && k ? ` · ${fmtNumber(Number(k.pending.value))}` : x === 'sync' && summary?.syncAttention ? ` · ${fmtNumber(summary.syncAttention)}` : ''}
            </button>
          ))}
        </div>
        <div className="pm-filters">
          <input className="fk-input pm-search" type="search" value={qText} onChange={(e) => setQText(e.target.value)} placeholder={tx('phm.search')} aria-label={tx('phm.search')} data-testid="pm-search" />
          <select className="fk-select" value={f.group} onChange={(e) => setView({ status: e.target.value })} aria-label={tx('phm.f.status')} data-testid="pm-f-status">
            <option value="">{tx('phm.f.status')}: {tx('phm.f.all')}</option>
            {GROUPS.map((g) => <option key={g} value={g}>{tx('phm.st.' + g)}</option>)}
          </select>
          <select className="fk-select" value={f.source} onChange={(e) => setView({ source: e.target.value })} aria-label={tx('phm.f.source')} data-testid="pm-f-source">
            <option value="">{tx('phm.f.source')}: {tx('phm.f.all')}</option>
            {SOURCES.map((x) => <option key={x} value={x}>{tx('phm.src.' + x)}</option>)}
          </select>
          {tab !== 'pending' ? (
            <select className="fk-select" value={f.method} onChange={(e) => setView({ method: e.target.value })} aria-label={tx('phm.f.method')} data-testid="pm-f-method">
              <option value="">{tx('phm.f.method')}: {tx('phm.f.all')}</option>
              <option value="sms">{tx('phm.m.sms')}</option><option value="manual">{tx('phm.m.manual')}</option>
            </select>
          ) : null}
          <label className="pm-check"><input type="checkbox" checked={f.shared === 'yes'} onChange={(e) => setView({ shared: e.target.checked ? 'yes' : null })} data-testid="pm-f-shared" /> {tx('phm.f.yes')}</label>
          {tab !== 'pending' ? (
            <select className="fk-select" value={f.sync} onChange={(e) => setView({ sync: e.target.value })} aria-label={tx('phm.f.sync')} data-testid="pm-f-sync">
              <option value="">{tx('phm.f.sync')}: {tx('phm.f.all')}</option>
              {SYNCS.map((x) => <option key={x} value={x}>{tx('phm.sync.' + x)}</option>)}
            </select>
          ) : null}
          {filtersOn ? <button type="button" className="fk-btn ghost sm" onClick={() => { setQText(''); setView({ status: null, source: null, method: null, shared: null, sync: null, preset: null, from: null, to: null, basis: null }); }} data-testid="pm-clear">{tx('phm.f.clear')}</button> : null}
        </div>
        {tab === 'history' ? (
          <PeriodBar compact allowAll value={period} server={list?.period ?? null} basis={f.basis}
            basisOptions={BASES.map((b) => ({ value: b, label: tx('phm.basis.' + b) }))} onBasis={(b) => setView({ basis: b })}
            onChange={(p) => setView({ preset: p.preset, from: p.from ?? null, to: p.to ?? null })} />
        ) : null}
        <div className="sub pm-order" data-testid="pm-order">{tab === 'pending' ? tx('phm.order.pending') : tx('phm.order.history')}</div>

        {listErr ? (isForbidden(listErr) ? <div className="err">{tx('phm.noPermission')}</div> : <ErrorRetry message={errText(listErr)} onRetry={refresh} />)
          : loading && !list ? <div className="state" role="status">{tx('pos.loading')}</div>
          : !list || list.items.length === 0 ? <Empty title={tab === 'pending' ? tx('phm.emptyPending') : tab === 'sync' ? tx('phm.emptySync') : tx('phm.emptyHistory')} />
          : (
            <div className="pm-table-wrap" aria-busy={loading}>
              <table className="tbl pm-table" data-testid={'pm-table-' + tab}>
                <thead><tr>
                  <th>{tx('phm.col.customer')}</th><th>{tx('phm.col.numbers')}</th>
                  {tab === 'sync' ? <><th>{tx('phm.col.sync')}</th><th>{tx('phm.col.attempts')}</th><th>{tx('phm.col.lastError')}</th><th>{tx('phm.col.next')}</th></>
                    : <><th>{tx('phm.col.source')}</th><th>{tx('phm.col.requestedBy')}</th><th>{tab === 'pending' ? tx('phm.col.expires') : tx('phm.col.date')}</th>{tab === 'pending' ? <th>{tx('phm.col.age')}</th> : null}<th>{tx('phm.col.status')}</th></>}
                  <th aria-label={tx('phm.col.actions')} />
                </tr></thead>
                <tbody>{list.items.map((r) => (
                  <tr key={r.id} className="pm-row" onClick={() => setOpenId(r.id)} data-testid="pm-row">
                    <td><div className="pm-name">{r.customerName || '—'}</div>{r.branchName ? <div className="sub pm-small">{r.branchName}</div> : null}</td>
                    <td><span className="pm-num">{r.oldPhoneMasked || '—'}</span> → <span className="pm-num">{r.newPhoneMasked || '—'}</span>{r.sharedWith > 0 ? <span className="pm-chip gold" title={tx('phm.up.shared', { n: String(r.sharedWith) })}>{tx('phm.kpi.shared')}</span> : null}</td>
                    {tab === 'sync' ? (
                      <><td><span className={'pm-chip ' + (r.sync.state === 'synced' ? 'ok' : r.sync.state === 'failed' ? 'bad' : 'warn')}>{tx('phm.sync.' + r.sync.state)}</span></td>
                        <td>{r.sync.attempts}</td><td className="pm-small">{r.sync.lastError || '—'}</td><td className="pm-small">{when(r.sync.nextAttemptAt)}</td></>
                    ) : (
                      <><td>{tx('phm.src.' + r.source)}</td><td className="pm-small">{r.requestedBy || '—'}</td>
                        <td className="pm-small">{when(tab === 'pending' ? r.expiresAt : f.basis === 'verified' ? r.verifiedAt : f.basis === 'applied' ? r.appliedAt : f.basis === 'audit' || f.basis === 'failed' ? r.updatedAt : r.createdAt)}</td>
                        {tab === 'pending' ? <td className="pm-small">{age(r.ageMinutes)}</td> : null}
                        <td><span className={'pm-chip ' + (stTone[r.status] ?? '')} data-testid="pm-status">{tx('phm.st.' + r.status)}</span>{r.verificationMethod === 'manual_exception' ? <div className="pm-small pm-warn">{tx('phm.m.manual')}</div> : null}</td></>
                    )}
                    <td><button type="button" className="fk-btn ghost sm" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} data-testid="pm-open">{tx('phm.open')}</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        <div className="pm-foot">
          <label className="pm-size">{tx('phm.pageSize')}{' '}
            <select className="fk-select" value={size} onChange={(e) => setView({ size: e.target.value })} data-testid="pm-size">{[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <Pager info={list} onPage={(p) => setView({ page: p > 1 ? p : null }, true)} />
        </div>
      </section>

      {openId ? <ChangeOverlay id={openId} tz={tz} onClose={() => setOpenId(null)} onChanged={refresh} /> : null}
      {updating ? <UpdatePhoneDialog onClose={() => setUpdating(false)} onOpen={(id) => { setUpdating(false); setOpenId(id); refresh(); }} /> : null}
    </div>
  );
}

// ── the change overlay (guide §06) ──────────────────────────────────────────────────────────────────────────
function ChangeOverlay({ id, tz, onClose, onChanged }: { id: string; tz?: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<PcDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [manual, setManual] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => { pcApi.detail(id).then((x) => { setD(x); setErr(null); }, setErr); }, [id]);
  useEffect(load, [load]);
  useEffect(() => { const h = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  const when = (iso: string | null | undefined) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '—');
  const cooldown = useMemo(() => Math.max(0, (d?.verification.resendAvailableInSeconds ?? 0) - tick), [d, tick]);
  useEffect(() => { setTick(0); }, [d]);
  const act = async (fn: () => Promise<unknown>, after?: (r: any) => void) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); after?.(r); load(); onChanged(); }
    catch (e) { setMsg(errText(e)); }
    finally { setBusy(false); }
  };
  const a = d?.actions;
  return (
    <FitDialog title={d ? tx('phm.ov.title', { name: d.customerName }) : tx('phm.title')} onClose={onClose} busy={busy} wide testId="pm-overlay"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy} data-testid="pm-ov-close">{tx('phm.ov.close')}</button>}>
      {err ? <ErrorRetry message={errText(err)} onRetry={load} /> : !d ? <div className="state" role="status">{tx('pos.loading')}</div> : (
        <div className="pm-ov" data-testid="pm-ov-body">
          <div className={'pm-banner ' + (d.trustedStillActive ? 'gold' : d.verificationMethod === 'manual_exception' ? 'warn' : 'ok')} role="status" data-testid="pm-ov-banner">
            {d.trustedStillActive ? tx('phm.ov.keepActive') : d.verificationMethod === 'manual_exception' ? tx('phm.m.manual_exception') : tx('phm.m.sms_verified')}
          </div>
          <div className="pm-ov-grid">
            <div className="pm-ov-box" data-testid="pm-ov-current">
              <div className="pm-ov-l">{tx('phm.ov.current')}</div>
              <div className="pm-ov-num">{d.current.phoneMasked || '—'}</div>
              <div className="pm-small">{tx('phm.ov.proof.' + (['sms_verified', 'manual_exception', 'unverified'].includes(d.current.proof) ? d.current.proof : 'unknown'))}</div>
            </div>
            <div className="pm-ov-box" data-testid="pm-ov-proposed">
              <div className="pm-ov-l">{tx('phm.ov.proposed')}</div>
              <div className="pm-ov-num">{d.newPhoneMasked || '—'}</div>
              <div><span className={'pm-chip ' + (stTone[d.status] ?? '')} data-testid="pm-ov-status">{tx('phm.st.' + d.status)}</span></div>
            </div>
          </div>
          <dl className="pm-dl">
            <dt>{tx('phm.ov.source')}</dt><dd>{tx('phm.src.' + d.source)}{d.branchName ? ` · ${d.branchName}` : ''}</dd>
            <dt>{tx('phm.col.date')}</dt><dd>{tx('phm.ov.requested', { time: when(d.createdAt), who: d.requestedBy || '—' })}</dd>
            <dt>{tx('phm.ov.stage')}</dt><dd data-testid="pm-ov-attempts">{tx('phm.ov.attempts', { left: String(d.verification.attemptsLeft), max: String(d.verification.attemptsLeft + d.verification.attemptsUsed) })}
              {d.verification.codeExpiresAt ? ` · ${tx('phm.ov.codeExpires', { time: when(d.verification.codeExpiresAt) })}` : ''}</dd>
            <dt>{tx('phm.ov.sender')}</dt><dd><span className={'pm-chip ' + (tone(d.verification.sender.state) ?? '')}>{tx('phm.state.' + d.verification.sender.state)}</span> {d.verification.sender.message}</dd>
            <dt>{tx('phm.ov.notice')}</dt><dd data-testid="pm-ov-notice">{tx('phm.ov.notice.' + d.oldNumberNotice.state)}{d.oldNumberNotice.at ? ` · ${when(d.oldNumberNotice.at)}` : ''}</dd>
            <dt>{tx('phm.col.sync')}</dt><dd>{tx('phm.sync.' + d.sync.state)}{d.sync.lastError ? ` · ${d.sync.lastError}` : ''}</dd>
          </dl>
          {d.state === 'duplicate_conflict' ? <div className="pm-note warn">{tx('phm.ov.dupConflict')}</div> : null}
          {d.verification.sender.state === 'not_configured' && d.trustedStillActive ? <div className="pm-note warn" data-testid="pm-ov-nosender">{tx('phm.ov.noSender')}</div> : null}

          {a && (a.sendCode || a.verifyCode) ? (
            <div className="pm-codebox" data-testid="pm-ov-code">
              <div className="pm-ov-l">{tx('phm.ov.reenter')}</div>
              <div className="pm-row-inputs">
                <input className="fk-input" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx('phm.ov.newNumber')} aria-label={tx('phm.ov.newNumber')} data-testid="pm-ov-phone" />
                {a.sendCode ? (
                  <button type="button" className="fk-btn ghost" disabled={busy || !phone.trim() || cooldown > 0} onClick={() => act(() => posCustomersApi.phoneSend(d.customerId, d.id, phone.trim()), (r) => setMsg(r?.message ?? null))} data-testid="pm-ov-send">
                    {d.verification.lastSentAt ? tx('phm.ov.resendCode') : tx('phm.ov.sendCode')}
                  </button>
                ) : null}
              </div>
              {cooldown > 0 ? <div className="pm-small" data-testid="pm-ov-cooldown">{tx('phm.ov.resendIn', { s: String(cooldown) })}</div> : null}
              {a.verifyCode ? (
                <div className="pm-row-inputs">
                  <input className="fk-input pm-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tx('phm.ov.code')} aria-label={tx('phm.ov.code')} data-testid="pm-ov-codeinput" />
                  <button type="button" className="fk-btn" disabled={busy || code.length !== 6 || !phone.trim()} onClick={() => act(() => posCustomersApi.phoneVerify(d.customerId, d.id, phone.trim(), code), (r) => { setCode(''); setMsg(r?.message ?? null); })} data-testid="pm-ov-verify">{tx('phm.ov.verify')}</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {manual && a?.manualException ? (
            <div className="pm-codebox warn" data-testid="pm-ov-manual">
              <div className="pm-note warn">{tx('phm.ov.manualWarn')}</div>
              <input className="fk-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tx('phm.ov.newNumber')} aria-label={tx('phm.ov.newNumber')} />
              <textarea className="fk-input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx('phm.ov.manualReason')} aria-label={tx('phm.ov.manualReason')} />
              <button type="button" className="fk-btn warn" disabled={busy || reason.trim().length < 12 || !phone.trim()} onClick={() => act(() => posCustomersApi.phoneManualConfirm(d.customerId, d.id, phone.trim(), reason.trim()), () => setManual(false))}>{tx('phm.ov.manual')}</button>
            </div>
          ) : null}

          {msg ? <div className="pm-note" role="status" data-testid="pm-ov-msg">{msg}</div> : null}

          <div className="pm-ov-actions">
            {a?.approve ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => posCustomersApi.phoneApprove(d.customerId, d.id))} data-testid="pm-ov-approve">{tx('phm.ov.approve')}</button> : null}
            {a?.retrySync ? <button type="button" className="fk-btn" disabled={busy} onClick={() => act(() => posCustomersApi.phoneRetrySync(d.customerId, d.id))} data-testid="pm-ov-retrysync">{tx('phm.ov.retrySync')}</button> : null}
            {a?.manualException && !manual ? <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => setManual(true)} data-testid="pm-ov-manual-open">{tx('phm.ov.manual')}</button> : null}
            {a?.cancel && !confirmCancel ? <button type="button" className="fk-btn ghost danger" disabled={busy} onClick={() => setConfirmCancel(true)} data-testid="pm-ov-cancel">{tx('phm.ov.cancel')}</button> : null}
            {a?.cancel && confirmCancel ? (
              <span className="pm-confirm" role="group" data-testid="pm-ov-cancel-confirm">{tx('phm.ov.cancelConfirm')}{' '}
                <button type="button" className="fk-btn danger sm" disabled={busy} onClick={() => act(() => posCustomersApi.phoneCancel(d.customerId, d.id), () => setConfirmCancel(false))} data-testid="pm-ov-cancel-yes">{tx('phm.ov.cancel')}</button>{' '}
                <button type="button" className="fk-btn ghost sm" disabled={busy} onClick={() => setConfirmCancel(false)}>{tx('phm.up.back')}</button>
              </span>
            ) : null}
          </div>

          {d.recent.length ? (
            <div className="pm-recent" data-testid="pm-ov-recent">
              <div className="pm-ov-l">{tx('phm.ov.history')}</div>
              <ul>{d.recent.map((h) => <li key={h.id}><span className="pm-small">{when(h.createdAt)}</span> · {h.newPhoneMasked || '—'} · <span className={'pm-chip ' + (stTone[h.status] ?? '')}>{tx('phm.st.' + h.status)}</span> · {tx('phm.src.' + h.source)}</li>)}</ul>
            </div>
          ) : null}
        </div>
      )}
    </FitDialog>
  );
}

// ── Update Phone: find the customer, enter the new number, review, save as pending ──────────────────────────
function UpdatePhoneDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (requestId: string) => void }) {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 300);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<PcPage<PcCustomer> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [pick, setPick] = useState<PcCustomer | null>(null);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [family, setFamily] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => requestId());
  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => { let live = true; pcApi.customers({ q: q || undefined, page, pageSize: 10 }).then((r) => { if (live) { setRes(r); setErr(null); } }, (e) => { if (live) setErr(e); }); return () => { live = false; }; }, [q, page]);
  const save = async () => {
    if (!pick) return;
    setBusy(true); setErr(null);
    try { const r = await posCustomersApi.phoneStart(pick.customerId, { phone: phone.trim(), reason: reason.trim() || undefined, sharedFamilyPhone: family || undefined, idempotencyKey: key }); onOpen(r.sessionId); }
    catch (e) { setErr(e); setReview(false); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('phm.up.title')} onClose={onClose} busy={busy} testId="pm-update-dialog"
      footer={<>
        <button type="button" className="fk-btn ghost" onClick={review ? () => setReview(false) : onClose} disabled={busy}>{review ? tx('phm.up.back') : tx('phm.ov.close')}</button>
        {pick ? (review
          ? <button type="button" className="fk-btn" onClick={() => void save()} disabled={busy} data-testid="pm-up-confirm">{tx('phm.up.confirm')}</button>
          : <button type="button" className="fk-btn" onClick={() => setReview(true)} disabled={!phone.trim()} data-testid="pm-up-review">{tx('phm.up.review')}</button>) : null}
      </>}>
      {err ? <div className="err" role="alert">{errText(err)}</div> : null}
      {!pick ? (
        <>
          <input className="fk-input" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={tx('phm.up.find')} aria-label={tx('phm.up.find')} data-testid="pm-up-search" autoFocus />
          {!res ? <div className="state" role="status">{tx('pos.loading')}</div> : res.items.length === 0 ? <Empty title={tx('phm.up.none')} /> : (
            <ul className="pm-pick">{res.items.map((c) => (
              <li key={c.customerId}>
                <span><b>{c.name}</b> <span className="pm-num">{c.phoneMasked || '—'}</span> <span className="pm-small">{tx('phm.ov.proof.' + (['sms_verified', 'manual_exception', 'unverified'].includes(c.proof) ? c.proof : 'unknown'))}</span>
                  {c.sharedWith ? <span className="pm-small"> · {tx('phm.up.shared', { n: String(c.sharedWith) })}</span> : null}</span>
                {c.openRequestId ? <button type="button" className="fk-btn ghost sm" onClick={() => onOpen(c.openRequestId!)} data-testid="pm-up-open">{tx('phm.up.open')}</button>
                  : <button type="button" className="fk-btn sm" onClick={() => setPick(c)} data-testid="pm-up-pick">{tx('phm.up.pick')}</button>}
              </li>
            ))}</ul>
          )}
          <Pager info={res} onPage={setPage} compact />
        </>
      ) : review ? (
        <div className="pm-note gold" data-testid="pm-up-reviewtext">{tx('phm.up.reviewText', { name: pick.name, old: pick.phoneMasked || '—', new: phone.trim() })}</div>
      ) : (
        <div className="pm-form">
          <div><b>{pick.name}</b> · <span className="pm-num">{pick.phoneMasked || '—'}</span></div>
          <label>{tx('phm.up.newNumber')}<input className="fk-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="pm-up-phone" autoFocus /></label>
          <label>{tx('phm.up.reason')}<input className="fk-input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <label className="pm-check"><input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} /> {tx('phm.up.family')}</label>
          <div className="sub">{tx('phm.ov.keepActive')}</div>
        </div>
      )}
    </FitDialog>
  );
}
