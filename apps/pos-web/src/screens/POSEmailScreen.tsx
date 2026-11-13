// POSEmailScreen.tsx — Communications → Email (/tenant/communications/email), rebuilt in place as the Email Management &
// Delivery Center (Email Complete Build Guide, Oct 31 2026). KEEPS the photographed settings — Sender name, "Send booking
// confirmations by email", "Email receipts to customers", Save email settings — saved through the same settings route, and
// now actually honoured by the send path. Adds: six counters on written bases (Delivered is N/A without verified provider
// events — never 0), provider health by layer with the next action (never green from a saved key), a staff-only test
// email, the email history (server search, status / type filters, From/To month calendar with a date basis, numbered
// pages 10/20/50, newest first), Email Details (events, attempts, links, protected Resend) and a composer that writes to
// ONE customer whose address is read from the customer record.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtMoney } from '../i18n/format';
import { posSettingsApi } from '../api/posSettingsApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { posEmailCenterApi, type EmSettings, type EmSummary, type EmHealth, type EmPage, type EmDetail, type EmStatus, type EmRecipientCheck, type EmTestPreview } from '../api/posEmailCenterApi';
import { posCustomerNotificationsApi } from '../api/posCustomerNotificationsApi';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, requestId, downloadText } from '../components/FitKit';
import { PeriodBar, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { reportError } from './reportsCommon';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const SIZES = [10, 20, 50] as const;
const STATUSES: EmStatus[] = ['accepted', 'delivered', 'failed', 'bounced', 'blocked', 'suppressed', 'simulated'];
const CATS = ['booking', 'receipt', 'reminder', 'follow_up', 'marketing', 'manual'] as const;
const BASES = ['created', 'sent', 'event', 'booking', 'receipt'] as const;
const at = (iso: string | null | undefined, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const tone = (s: string): 'ok' | 'warn' | 'bad' | undefined => (['ready', 'healthy', 'receiving', 'delivered', 'ok', 'verified'].includes(s) ? 'ok' : ['down', 'failed', 'bounced', 'invalid', 'setup_required', 'not_configured'].includes(s) ? 'bad' : ['attention_required', 'degraded', 'stale', 'unknown', 'not_checked', 'incomplete'].includes(s) ? 'warn' : undefined);
const outcome = (o: string) => t(o === 'accepted' || o === 'sent' ? 'emc.r.accepted' : o === 'simulated' ? 'emc.r.simulated' : o === 'blocked' || o === 'refused' ? 'emc.r.blocked' : 'emc.r.failed');

export function POSEmailScreen() {
  const nav = useNavigate();
  // ── settings ──
  const [raw, setRaw] = useState<any>(null);
  const [eff, setEff] = useState<EmSettings | null>(null);
  const [name, setName] = useState(''); const [reply, setReply] = useState(''); const [booking, setBooking] = useState(true); const [receipts, setReceipts] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle'); const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // ── center ──
  const [summary, setSummary] = useState<EmSummary | null>(null); const [health, setHealth] = useState<EmHealth | null>(null);
  const [page, setPage] = useState<EmPage | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' });
  const [basis, setBasis] = useState<string>('created'); const [status, setStatus] = useState(''); const [cat, setCat] = useState('');
  const [search, setSearch] = useState(''); const q = useDebounced(search, 300);
  const [pg, setPg] = useState(1); const [size, setSize] = useState<number>(20);
  const [checking, setChecking] = useState(false); const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(''); const [testOk, setTestOk] = useState(false); const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testPv, setTestPv] = useState<EmTestPreview | null>(null);   // extras Email 06: the wizard's preview step (read only)
  const [resending, setResending] = useState(false);   // extras Email 08: one Resend request at a time from this screen
  const [exportMsg, setExportMsg] = useState<string | null>(null); const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<EmDetail | null>(null); const [resendOk, setResendOk] = useState(false); const [detailMsg, setDetailMsg] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const dirty = !!eff && (name.trim() !== eff.senderName || (reply.trim().toLowerCase() || null) !== (eff.replyTo || null) || booking !== eff.bookingConfirmations || receipts !== eff.receipts);
  const loadSettings = useCallback(async () => {
    const [s, r] = await Promise.all([posEmailCenterApi.settings(), posSettingsApi.getCategory('notifications-reminders')]);
    setEff(s); setRaw(r); setName(s.senderName); setReply(s.replyTo ?? ''); setBooking(s.bookingConfirmations); setReceipts(s.receipts);
  }, []);
  const pq = useMemo(() => (period.preset === 'custom' ? { preset: 'custom', from: period.from, to: period.to } : { preset: period.preset }), [period]);
  const loadTop = useCallback(async () => { const [s, h] = await Promise.all([posEmailCenterApi.summary(pq), posEmailCenterApi.health()]); setSummary(s); setHealth(h); }, [pq]);
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try { setPage(await posEmailCenterApi.history({ ...pq, q: q.trim() || undefined, status: status || undefined, category: cat || undefined, basis, page: pg, pageSize: size })); setError(null); }
    catch (e: any) { setError(reportError(e, t('emc.hist.title'))); }
    finally { setLoading(false); }
  }, [pq, q, status, cat, basis, pg, size]);
  const refresh = useCallback(async () => { try { await Promise.all([loadSettings(), loadTop()]); setError(null); } catch (e: any) { setError(reportError(e, t('emc.title'))); } void loadHistory(); }, [loadSettings, loadTop, loadHistory]);
  useEffect(() => { void loadSettings().catch((e) => setError(reportError(e, t('emc.title')))); }, [loadSettings]);
  useEffect(() => { void loadTop().catch((e) => setError(reportError(e, t('emc.title')))); }, [loadTop]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => { setPg(1); }, [q, status, cat, basis, size, pq]);   // filter changes go back to page 1

  const save = async () => {
    setSaveState('saving'); setSaveMsg(null);
    try {
      const existing: string[] = Array.isArray(raw?.receiptDelivery) ? raw.receiptDelivery : [];
      const others = existing.filter((x) => String(x).toLowerCase() !== 'email');
      await posSettingsApi.updateCategory('notifications-reminders', { emailSenderName: name.trim(), emailReplyTo: reply.trim().toLowerCase(), emailConfirmation: booking, receiptDelivery: receipts ? [...others, 'Email'] : others });
      await loadSettings(); setSaveState('saved');
    } catch (e: any) { setSaveState('failed'); setSaveMsg(e?.message || null); }
  };
  const check = async () => { setChecking(true); setHealthMsg(null); try { setHealth(await posEmailCenterApi.check()); void loadTop(); } catch (e: any) { setHealthMsg(e?.message || t('emc.r.failed')); } finally { setChecking(false); } };
  const previewTest = async () => { setTestMsg(null); setTestOk(false); try { setTestPv(await posEmailCenterApi.testPreview(testTo.trim())); } catch (e: any) { setTestPv(null); setTestMsg(e?.message || t('emc.r.failed')); } };
  const sendTest = async () => { setTestMsg(null); try { const r = await posEmailCenterApi.test(testTo.trim(), requestId()); setTestMsg(outcome(r.outcome)); setTestOk(false); setTestPv(await posEmailCenterApi.testPreview(testTo.trim()).catch(() => null)); void refresh(); } catch (e: any) { setTestMsg(e?.message || t('emc.r.failed')); } };
  // the preview belongs to the address it was made for; typing another address asks for a new preview
  const testReady = !!testPv && testPv.recipient?.address === testTo.trim().toLowerCase() && testPv.recipient?.staff === true;
  // extras Email 15: the authorized, masked, audited notification-records export, narrowed to email and this screen's filters
  const exportEmail = async () => {
    setExporting(true); setExportMsg(null);
    try { const csv = await posCustomerNotificationsApi.exportCsv({ channel: 'email', ...pq, q: q.trim() || undefined }); downloadText('email-records.csv', String(csv)); setExportMsg(t('emc.exp.done')); }
    catch (e: any) { setExportMsg(e?.message || t('emc.r.failed')); }
    finally { setExporting(false); }
  };
  const openDetail = async (id: string) => { setDetailMsg(null); setResendOk(false); try { setDetail(await posEmailCenterApi.detail(id)); } catch (e: any) { setError(reportError(e, t('emc.d.title'))); } };
  const resend = async () => {
    if (!detail || resending) return;
    setResending(true);
    try { const r = await posEmailCenterApi.resend(detail.id, requestId()); setDetailMsg(t('emc.d.resend.done', { o: r.refusalCode ? `${outcome('refused')} (${r.refusalCode})` : outcome(r.outcome) })); setResendOk(false); void loadHistory(); void loadTop(); setDetail(await posEmailCenterApi.detail(detail.id)); }
    catch (e: any) { setDetailMsg(e?.message || t('emc.r.failed')); }
    finally { setResending(false); }
  };

  const server: ServerPeriod | null = summary?.window ? { preset: summary.window.preset as ServerPeriod['preset'], from: summary.window.from, to: summary.window.to, tz: summary.window.tz, today: summary.window.today } : null;
  const tz = summary?.window?.tz;
  const canEdit = !!eff?.canEdit;

  return (
    <div className="work emc" data-testid="emc">
      <div className="vh emc-head">
        <div><h1>{t('emc.title')}</h1><div className="sub">{t('emc.sub')}</div></div>
        <div className="emc-actions">
          <button type="button" className="btn ghost" onClick={() => void refresh()} data-testid="emc-refresh">{t('emc.refresh')}</button>
          <button type="button" className="btn" onClick={() => setComposing(true)} data-testid="emc-compose">{t('emc.compose')}</button>
        </div>
      </div>
      {error ? <ErrorRetry message={error} onRetry={() => void refresh()} /> : null}

      <div className="emc-kpis" data-testid="emc-kpis">
        <KpiCard label={t('emc.kpi.provider')} value={health ? t('emc.h.overall.' + health.overall) : '…'} tone={health ? tone(health.overall) : undefined} loading={!health} testId="emc-kpi-provider" />
        <KpiCard label={t('emc.kpi.accepted')} value={summary ? summary.accepted : '…'} sub={t('emc.kpi.accepted.sub')} loading={!summary} testId="emc-kpi-accepted" />
        <KpiCard label={t('emc.kpi.delivered')} value={summary ? (summary.delivered == null ? t('emc.na') : summary.delivered) : '…'} sub={summary && summary.delivered == null ? t('emc.na.sub') : summary?.deliveryRate != null ? `${t('emc.kpi.rate')} ${summary.deliveryRate}%` : undefined} loading={!summary} testId="emc-kpi-delivered" />
        <KpiCard label={t('emc.kpi.failed')} value={summary ? `${summary.failed} / ${summary.bounced}` : '…'} tone={summary && summary.failed + summary.bounced > 0 ? 'bad' : undefined} loading={!summary} testId="emc-kpi-failed" />
        <KpiCard label={t('emc.kpi.booking')} value={summary ? summary.bookingConfirmations : '…'} loading={!summary} testId="emc-kpi-booking" />
        <KpiCard label={t('emc.kpi.receipt')} value={summary ? summary.receipts : '…'} loading={!summary} testId="emc-kpi-receipt" />
      </div>

      <div className="emc-cols">
        <section className="panel emc-settings" data-testid="emc-settings">
          <h3>{t('emc.set.title')}</h3>
          {!canEdit && eff ? <div className="sub">{t('emc.set.readonly')}</div> : null}
          <label className="emc-field">{t('emc.set.name')}<span className="sub">{t('emc.set.name.help')}</span>
            <input value={name} maxLength={80} disabled={!canEdit} onChange={(e) => { setName(e.target.value); setSaveState('idle'); }} data-testid="emc-name" /></label>
          <label className="emc-field">{t('emc.set.reply')}<span className="sub">{t('emc.set.reply.help')}</span>
            <input type="email" value={reply} maxLength={254} disabled={!canEdit} onChange={(e) => { setReply(e.target.value); setSaveState('idle'); }} data-testid="emc-reply" /></label>
          <div className="emc-field"><span>{t('emc.set.from')}</span><span className="emc-mono" data-testid="emc-from">{eff?.fromAddress ?? '—'}</span></div>
          <label className="emc-check"><input type="checkbox" checked={booking} disabled={!canEdit} onChange={(e) => { setBooking(e.target.checked); setSaveState('idle'); }} data-testid="emc-booking" />{t('emc.set.booking')}</label>
          <label className="emc-check"><input type="checkbox" checked={receipts} disabled={!canEdit} onChange={(e) => { setReceipts(e.target.checked); setSaveState('idle'); }} data-testid="emc-receipts" />{t('emc.set.receipts')}</label>
          <div className="emc-save">
            <button type="button" className="btn" disabled={!canEdit || saveState === 'saving' || !dirty || !name.trim()} onClick={() => void save()} data-testid="emc-save">{saveState === 'saving' ? t('emc.set.saving') : t('emc.set.save')}</button>
            <span role="status" className="sub" data-testid="emc-save-state">
              {saveState === 'failed' ? `${t('emc.set.failed')}${saveMsg ? ` — ${saveMsg}` : ''}` : dirty ? t('emc.set.unsaved') : saveState === 'saved' ? `${t('emc.set.saved')} · ${at(eff?.savedAt, tz)}` : eff?.savedAt ? `${t('emc.set.savedAt')} ${at(eff.savedAt, tz)}` : ''}
            </span>
          </div>
        </section>

        <section className="panel emc-health" data-testid="emc-health">
          <div className="emc-row"><h3>{t('emc.h.title')}</h3>
            <span className={`emc-badge ${tone(health?.overall ?? '') ?? ''}`} data-testid="emc-health-overall">{health ? t('emc.h.overall.' + health.overall) : '…'}</span></div>
          <ul className="emc-layers">
            {(health?.layers ?? []).map((l) => (
              <li key={l.key} data-testid={`emc-layer-${l.key}`}>
                <div className="emc-row"><b>{t('emc.layer.' + l.key)}</b><span className={`emc-badge ${tone(l.state) ?? ''}`}>{t('emc.state.' + l.state)}</span></div>
                <div className="sub">{l.detail}</div>
                {l.next ? <div className="emc-next">→ {t('emc.next.' + l.next)}</div> : null}
              </li>
            ))}
          </ul>
          <div className="sub">{t('emc.h.last')}: {health?.lastCheckedAt ? at(health.lastCheckedAt, tz) : t('emc.h.never')} · {t('emc.h.lastOk')}: {health?.lastSuccessAt ? at(health.lastSuccessAt, tz) : '—'}</div>
          {health?.evidence ? <div className="emc-evidence" data-testid="emc-evidence">
            <h4>{t('emc.ev.title')}</h4>
            <div className="sub">{t('emc.ev.lastAccepted')}: {at(health.evidence.lastAcceptedAt, tz)} · {t('emc.ev.lastDelivered')}: {at(health.evidence.lastDeliveredAt, tz)}</div>
            {health.evidence.events.length ? <ol className="emc-events" data-testid="emc-ev-list">{health.evidence.events.map((e, i) => <li key={`${e.emailId}-${i}`} data-testid="emc-ev">
              {at(e.at, tz)} · {statusLabel('state', e.status)} · {e.verified ? t('emc.d.verified') : t('emc.ev.unsigned')}{e.applied ? ` · ${t('emc.d.applied')}` : ` · ${t('emc.ev.evidenceOnly')}`}
              {' '}<button type="button" className="btn ghost sm" onClick={() => void openDetail(e.emailId)}>{t('emc.hist.view')}</button></li>)}</ol>
              : <div className="sub" data-testid="emc-ev-none">{t('emc.ev.none')}</div>}
          </div> : null}
          <div className="emc-save"><button type="button" className="btn ghost" disabled={checking} onClick={() => void check()} data-testid="emc-check">{checking ? t('emc.h.checking') : t('emc.h.check')}</button>{healthMsg ? <span className="sub" role="status">{healthMsg}</span> : null}</div>
          <details className="emc-test"><summary>{t('emc.h.test')}</summary>
            <div className="sub">{t('emc.h.test.help')}</div>
            <input type="email" placeholder={t('emc.h.test.to')} aria-label={t('emc.h.test.to')} value={testTo} onChange={(e) => { setTestTo(e.target.value); setTestOk(false); }} data-testid="emc-test-to" />
            <button type="button" className="btn ghost sm" disabled={!testTo.trim()} onClick={() => void previewTest()} data-testid="emc-test-preview">{t('emc.tw.preview')}</button>
            {testPv ? <div className="emc-preview" data-testid="emc-test-pv">
              {testPv.recipient ? <div className={testPv.recipient.staff ? 'sub' : 'fk-note'} role="status" data-testid="emc-test-staff">{t(testPv.recipient.staff ? 'emc.tw.staff' : 'emc.tw.notStaff', { a: testPv.recipient.address })}</div> : null}
              <b>{testPv.subject}</b><pre className="emc-body">{testPv.body}</pre>
              <h4>{t('emc.tw.history')}</h4>
              {testPv.history.length ? <ol className="emc-events" data-testid="emc-test-history">{testPv.history.map((h) => <li key={h.id}>{at(h.at, tz)} · {h.to} · {t('emc.st.' + h.status)}{h.reason ? ` — ${h.reason}` : ''}{h.deliveredAt ? ` · ${t('emc.d.delivered')} ${at(h.deliveredAt, tz)}` : ''}</li>)}</ol>
                : <div className="sub" data-testid="emc-test-history-none">{t('emc.tw.noHistory')}</div>}
            </div> : null}
            <label className="emc-check"><input type="checkbox" checked={testOk} disabled={!testReady} onChange={(e) => setTestOk(e.target.checked)} data-testid="emc-test-confirm" />{t('emc.h.test.confirm')}</label>
            <button type="button" className="btn" disabled={!testOk || !testReady} onClick={() => void sendTest()} data-testid="emc-test-send">{t('emc.h.test.send')}</button>
            {testMsg ? <div className="sub" role="status" data-testid="emc-test-msg">{testMsg}</div> : null}
          </details>
        </section>
      </div>

      <DeliveryHygiene summary={summary} tz={tz} />

      <section className="panel emc-history" data-testid="emc-history">
        <div className="emc-row"><h3>{t('emc.hist.title')}</h3><span className="sub" data-testid="emc-count">{page ? t('emc.hist.count', { n: page.total }) : ''}</span>
          <button type="button" className="btn ghost sm" disabled={exporting} onClick={() => void exportEmail()} data-testid="emc-export">{exporting ? t('emc.exp.busy') : t('emc.exp.button')}</button>
          {exportMsg ? <span className="sub" role="status" data-testid="emc-export-msg">{exportMsg}</span> : null}</div>
        <div className="sub">{t('emc.exp.rule')}</div>
        <div className="emc-filters">
          <input className="fk-search emc-search" placeholder={t('emc.hist.search')} aria-label={t('emc.hist.search')} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="emc-search" />
          <select className="fk-select" aria-label={t('emc.hist.status')} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="emc-f-status">
            <option value="">{t('emc.hist.status')}: {t('emc.hist.all')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t('emc.st.' + s)}</option>)}
          </select>
          <select className="fk-select" aria-label={t('emc.hist.category')} value={cat} onChange={(e) => setCat(e.target.value)} data-testid="emc-f-cat">
            <option value="">{t('emc.hist.category')}: {t('emc.hist.all')}</option>{CATS.map((c) => <option key={c} value={c}>{t('emc.cat.' + c)}</option>)}
          </select>
          <PeriodBar compact allowAll value={period} server={server} onChange={(p) => setPeriod(p)} basis={basis} onBasis={setBasis} basisOptions={BASES.map((b) => ({ value: b, label: t('emc.basis.' + b) }))} />
          <button type="button" className="btn ghost sm" onClick={() => { setSearch(''); setStatus(''); setCat(''); setBasis('created'); setPeriod({ preset: 'month' }); }} data-testid="emc-clear">{t('emc.hist.clear')}</button>
        </div>
        {page?.masked ? <div className="sub">{t('emc.hist.masked')}</div> : null}
        {loading && !page ? <div className="state">{t('emc.loading')}</div> : page && page.items.length === 0 ? <Empty title={t('emc.hist.empty')} /> : (
          <div className="emc-table-wrap">
            <table className="tbl emc-table" data-testid="emc-table">
              <thead><tr><th>{t('emc.hist.date')}</th><th>{t('emc.hist.customer')}</th><th>{t('emc.hist.type')}</th><th>{t('emc.hist.statusCol')}</th><th>{t('emc.hist.action')}</th></tr></thead>
              <tbody>{(page?.items ?? []).map((r) => (
                <tr key={r.id} data-testid="emc-row">
                  <td>{at(r.createdAt, tz)}</td>
                  <td><div className="emc-strong">{r.customer?.name ?? '—'}</div><div className="sub">{r.to}</div>{r.subject ? <div className="sub emc-subject">{r.subject}</div> : null}</td>
                  <td>{t('emc.cat.' + r.category)}</td>
                  <td><span className={`emc-badge ${tone(r.status) ?? ''}`} data-testid="emc-row-status">{t('emc.st.' + r.status)}</span>{r.reason ? <div className="sub emc-reason">{r.reason}</div> : null}
                    {r.nextAction ? <div className="emc-next" data-testid="emc-row-next">→ {t('emc.next2.' + r.nextAction)}</div> : null}</td>
                  <td><button type="button" className="btn ghost sm" onClick={() => void openDetail(r.id)} data-testid="emc-row-view">{t('emc.hist.view')}</button></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        <div className="emc-row emc-foot">
          <Pager info={page ? { page: page.page, pageSize: page.pageSize, totalItems: page.total, totalPages: page.totalPages } : null} onPage={setPg} />
          <label className="sub">{t('emc.hist.rows')} <select className="fk-select" value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="emc-size">{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
      </section>

      {detail ? (
        <FitDialog title={t('emc.d.title')} subtitle={detail.subject ?? undefined} onClose={() => setDetail(null)} wide testId="emc-detail"
          footer={<button type="button" className="btn ghost" onClick={() => setDetail(null)} data-testid="emc-d-close">{t('emc.d.close')}</button>}>
          <dl className="emc-dl">
            <dt>{t('emc.hist.statusCol')}</dt><dd><span className={`emc-badge ${tone(detail.status) ?? ''}`} data-testid="emc-d-status">{t('emc.st.' + detail.status)}</span>{detail.reason ? ` — ${detail.reason}` : ''}</dd>
            {detail.nextAction ? <><dt>{t('emc.d.next')}</dt><dd data-testid="emc-d-next">{t('emc.next2.' + detail.nextAction)}</dd></> : null}
            <dt>{t('emc.d.from')}</dt><dd>{detail.from.name ? `${detail.from.name} <${detail.from.address}>` : detail.from.address}</dd>
            {detail.replyTo ? <><dt>{t('emc.d.reply')}</dt><dd>{detail.replyTo}</dd></> : null}
            <dt>{t('emc.d.to')}</dt><dd>{detail.to}</dd>
            <dt>{t('emc.d.customer')}</dt><dd>{detail.customer?.name ?? '—'}{detail.customer ? <> <button type="button" className="btn ghost sm" onClick={() => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(detail.customer!.id)}`)}>{t('emc.d.openCustomer')}</button> <button type="button" className="btn ghost sm" onClick={() => nav(`/tenant/communications/notifications?timeline=${encodeURIComponent(detail.customer!.id)}`)} data-testid="emc-d-timeline">{t('emc.d.timeline')}</button></> : null}</dd>
            <dt>{t('emc.d.category')}</dt><dd>{t('emc.cat.' + detail.category)} · {detail.consent}</dd>
            {detail.branch ? <><dt>{t('emc.d.branch')}</dt><dd>{detail.branch.name}</dd></> : null}
            <dt>{t('emc.d.created')}</dt><dd>{at(detail.createdAt, tz)}</dd>
            <dt>{t('emc.d.delivered')}</dt><dd>{detail.deliveredAt ? at(detail.deliveredAt, tz) : '—'}</dd>
            <dt>{t('emc.d.provider')}</dt><dd className="emc-mono">{detail.providerReference ?? '—'}</dd>
            {detail.links.appointmentId || detail.links.receipts.length ? <><dt>{t('emc.d.links')}</dt><dd>
              {detail.links.appointmentId ? <span>{t('emc.d.booking')} {detail.links.appointmentId.slice(0, 8).toUpperCase()} </span> : null}
              {detail.links.receipts.map((x) => <span key={x.number}>{t('emc.d.receipt')} {x.number} </span>)}</dd></> : null}
          </dl>
          {detail.body != null ? <><h4>{t('emc.d.body')}</h4><pre className="emc-body" data-testid="emc-d-body">{detail.body}</pre></> : null}
          <h4>{t('emc.d.events')}</h4>
          {detail.events.length ? <ul className="emc-events" data-testid="emc-d-events">{detail.events.map((e, i) => <li key={i}>{at(e.at, tz)} · {statusLabel('state', e.status)}{e.verified ? ` · ${t('emc.d.verified')}` : ''}{e.applied ? ` · ${t('emc.d.applied')}` : ''}</li>)}</ul>
            : <div className="sub" data-testid="emc-d-noevents">{t('emc.d.noEvents')}</div>}
          <h4>{t('emc.d.attempts')}</h4>
          <ol className="emc-events" data-testid="emc-d-attempts">{detail.attempts.map((a) => <li key={a.id} className={a.isThis ? 'emc-strong' : ''}>{at(a.at, tz)} · {t('emc.st.' + a.status)}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ol>
          {detail.canResend ? (
            <div className="emc-resend">
              <label className="emc-check"><input type="checkbox" checked={resendOk} onChange={(e) => setResendOk(e.target.checked)} data-testid="emc-d-resend-confirm" />{t('emc.d.resend.confirm')}</label>
              <button type="button" className="btn" disabled={!resendOk || resending} onClick={() => void resend()} data-testid="emc-d-resend">{t('emc.d.resend')}</button>
            </div>
          ) : null}
          {detailMsg ? <div className="sub" role="status" data-testid="emc-d-msg">{detailMsg}</div> : null}
        </FitDialog>
      ) : null}

      {composing ? <Composer onClose={() => setComposing(false)} onSent={() => { void loadHistory(); void loadTop(); }} /> : null}
    </div>
  );
}

const dur = (sec: number | null) => (sec == null ? '—' : sec < 90 ? t('emc.lat.sec', { n: sec }) : sec < 5400 ? t('emc.lat.min', { n: Math.round(sec / 60) }) : t('emc.lat.hr', { n: Math.round(sec / 360) / 10 }));
/** Email 11 (accepted → verified delivered) + Email 05 (suppression list by reason, with the approved next step). Both come
 *  from the server's summary; nothing here changes a suppression or sends anything. */
function DeliveryHygiene({ summary, tz }: { summary: EmSummary | null; tz?: string }) {
  if (!summary) return null;
  const lat = summary.latency; const hy = summary.suppression; const us = summary.usage;
  return (
    <section className="panel emc-hygiene" data-testid="emc-hygiene">
      {us ? <div data-testid="emc-usage">
        <div className="emc-row"><h3>{t('emc.use.title')}</h3><span className="sub" data-testid="emc-use-sent">{t('emc.use.sent', { n: us.handedToProvider })}</span></div>
        <div className="emc-row"><span>{t('emc.use.cost')}</span><b data-testid="emc-use-cost">{us.state === 'known' && us.costCents != null ? fmtMoney(us.costCents)
          : us.state === 'cost_unknown' ? t('emc.use.unknown', { c: us.withProviderCost ?? 0, n: us.handedToProvider }) : us.state === 'not_authorized' ? t('emc.use.notAuthorized') : '—'}</b></div>
        <div className="sub">{t('emc.use.basis')}</div>
      </div> : null}
      <div className="emc-row"><h3>{t('emc.lat.title')}</h3></div>
      {lat == null ? <div className="sub" data-testid="emc-lat-na">{t('emc.lat.na')}</div>
        : lat.measured === 0 ? <div className="sub" data-testid="emc-lat-none">{t('emc.lat.none')}</div>
        : <div data-testid="emc-lat">
            <div className="emc-row"><span>{t('emc.lat.median')}</span><b data-testid="emc-lat-median">{dur(lat.medianSeconds)}</b><span>{t('emc.lat.p90')}</span><b>{dur(lat.p90Seconds)}</b><span>{t('emc.lat.slowest')}</span><b>{dur(lat.slowestSeconds)}</b></div>
            <div className="sub">{t('emc.lat.basis', { n: lat.measured })}</div>
          </div>}
      {hy ? <>
        <div className="emc-row"><h3>{t('emc.hy.title')}</h3><span className="sub" data-testid="emc-hy-total">{t('emc.hy.total', { n: hy.total })}</span></div>
        <ul className="emc-layers">
          {hy.buckets.map((b) => (
            <li key={b.key} data-testid={`emc-hy-${b.key}`}>
              <div className="emc-row"><b>{t('emc.hy.' + b.key)}</b><span className={`emc-badge ${b.addresses > 0 && (b.key === 'hard_bounce' || b.key === 'complaint') ? 'warn' : ''}`}>{b.addresses}</span></div>
              <div className="sub">{t('emc.hy.scope.' + b.scope)}{b.latestAt ? ` · ${t('emc.hy.latest')} ${at(b.latestAt, tz)}` : ''}</div>
              {b.addresses > 0 ? <div className="emc-next">→ {t('emc.hy.next.' + b.next)}</div> : null}
            </li>
          ))}
        </ul>
        <div className="sub">{t('emc.hy.basis')}</div>
      </> : null}
    </section>
  );
}

const EMAIL_DRAFT_KEY = 'aps.emc.draft';
function readEmailDraft(): { subject: string; body: string } {
  try { const v = JSON.parse(sessionStorage.getItem(EMAIL_DRAFT_KEY) || 'null'); if (v && typeof v === 'object') return { subject: String(v.subject ?? '').slice(0, 150), body: String(v.body ?? '').slice(0, 5000) }; } catch { /* no storage */ }
  return { subject: '', body: '' };
}
function writeEmailDraft(subject: string, body: string) {
  try { if (subject || body) sessionStorage.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ subject, body })); else sessionStorage.removeItem(EMAIL_DRAFT_KEY); } catch { /* best effort */ }
}

function Composer({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [query, setQuery] = useState(''); const dq = useDebounced(query, 300);
  const [hits, setHits] = useState<any[]>([]); const [cust, setCust] = useState<any | null>(null);
  // Draft autosave: subject + body survive closing the composer, a re-login or a language switch in this browser tab
  // (sessionStorage; the recipient is NOT saved — no customer data is kept); a successful send clears the draft
  const [saved] = useState(readEmailDraft);   // read once, when the composer opens
  const [subject, setSubject] = useState(saved.subject); const [body, setBody] = useState(saved.body); const [ok, setOk] = useState(false);
  const restored = !!(saved.subject || saved.body);
  useEffect(() => { writeEmailDraft(subject, body); }, [subject, body]);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dq.trim() || cust) { setHits([]); return; }
    let live = true;
    posCustomersApi.quickSearch(dq.trim()).then((r: any) => { if (live) setHits((r?.items ?? r ?? []).slice(0, 8)); }).catch(() => { if (live) setHits([]); });
    return () => { live = false; };
  }, [dq, cust]);
  const email = cust ? String(cust.email ?? '') : '';
  // Email 10: once a customer is picked, the server checks the recipient (counts only; nothing is sent). A shared address
  // must be acknowledged before Send is enabled.
  const [check, setCheck] = useState<EmRecipientCheck | null>(null); const [checkFailed, setCheckFailed] = useState(false); const [ackShared, setAckShared] = useState(false);
  const custId = cust ? String(cust.customerId ?? cust.id) : '';
  useEffect(() => {
    setCheck(null); setCheckFailed(false); setAckShared(false);
    if (!custId) return;
    let live = true;
    posEmailCenterApi.recipientCheck(custId).then((r) => { if (live) setCheck(r?.recipient ?? null); }).catch(() => { if (live) setCheckFailed(true); });
    return () => { live = false; };
  }, [custId]);
  const needsAck = check?.confidence === 'shared_address';
  const send = async () => {
    if (!cust) return; setBusy(true); setMsg(null);
    try { const r = await posEmailCenterApi.compose({ customerId: String(cust.customerId ?? cust.id), subject: subject.trim(), body: body.trim() }, requestId()); writeEmailDraft('', ''); setMsg(t('emc.c.sent', { o: outcome(r.outcome) + (r.reason ? ` (${r.reason})` : '') })); setOk(false); onSent(); }
    catch (e: any) { setMsg(e?.message || t('emc.r.failed')); }
    finally { setBusy(false); }
  };
  return (
    <FitDialog title={t('emc.c.title')} onClose={onClose} busy={busy} wide testId="emc-composer"
      footer={<><button type="button" className="btn ghost" onClick={onClose} data-testid="emc-c-close">{t('emc.d.close')}</button>
        <button type="button" className="btn" disabled={!cust || !email || !subject.trim() || !body.trim() || !ok || busy || (needsAck && !ackShared)} onClick={() => void send()} data-testid="emc-c-send">{t('emc.c.send')}</button></>}>
      <label className="emc-field">{t('emc.c.customer')}
        {cust ? <div className="emc-row"><span className="emc-strong" data-testid="emc-c-picked">{cust.displayName ?? cust.fullName ?? `${cust.firstName ?? ''} ${cust.lastName ?? ''}`}</span><span className="sub">{email || t('emc.c.noEmail')}</span>
          <button type="button" className="btn ghost sm" onClick={() => { setCust(null); setQuery(''); }}>×</button></div>
          : <input className="fk-search" placeholder={t('emc.c.search')} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="emc-c-search" />}
      </label>
      {cust && check && check.confidence !== 'unique' && check.confidence !== 'no_address' ? (
        <div className="fk-note" role="alert" data-testid="emc-c-identity">
          {check.confidence === 'shared_address' ? t('emc.c.id.shared', { n: check.sharedAddressCustomers, a: check.addressMasked ?? '—' }) : t('emc.c.id.name', { n: check.sameNameCustomers })}
          {needsAck ? <label className="emc-check"><input type="checkbox" checked={ackShared} onChange={(e) => setAckShared(e.target.checked)} data-testid="emc-c-identity-ack" />{t('emc.c.id.ack')}</label> : null}
        </div>) : null}
      {cust && check?.suppression ? <div className="fk-note" role="status" data-testid="emc-c-suppressed">{t(check.suppression === 'marketing' ? 'emc.c.id.supMarketing' : 'emc.c.id.supAll')}</div> : null}
      {cust && checkFailed ? <div className="sub" role="status" data-testid="emc-c-identity-unknown">{t('emc.c.id.unknown')}</div> : null}
      {!cust && hits.length ? <ul className="emc-hits">{hits.map((h: any) => <li key={h.customerId ?? h.id}><button type="button" className="btn ghost sm" onClick={() => setCust(h)} data-testid="emc-c-hit">{h.displayName ?? h.fullName ?? `${h.firstName ?? ''} ${h.lastName ?? ''}`} · {h.email || t('emc.c.noEmail')}</button></li>)}</ul> : null}
      {restored ? <div className="fk-note" role="status" data-testid="emc-c-restored">{t('emc.c.restored')}</div> : null}
      <label className="emc-field">{t('emc.c.subject')}<input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} data-testid="emc-c-subject" /></label>
      <label className="emc-field">{t('emc.c.body')}<textarea rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="emc-c-body" /></label>
      {subject.trim() || body.trim() ? <><h4>{t('emc.c.preview')}</h4><div className="emc-preview" data-testid="emc-c-preview"><b>{subject}</b><pre className="emc-body">{body}</pre><div className="sub">{t('emc.c.transactional')}</div></div></> : null}
      <label className="emc-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="emc-c-confirm" />{t('emc.c.confirm')}</label>
      {msg ? <div className="sub" role="status" data-testid="emc-c-msg">{msg}</div> : null}
    </FitDialog>
  );
}
