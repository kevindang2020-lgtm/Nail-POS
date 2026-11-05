// POSAiBusinessScreen.tsx — AI Center → AI Business Assistant. Wired to POST /pos/ai-business/ask (pos.ai.view).
// A question (a suggested-intent chip or free text) resolves to ONE authorized backend tool; the screen renders the
// model's evidence-grounded answer plus the supporting numbers, freshness, notes/caveats, and a drilldown to the real
// report. When the AI package is unavailable it degrades honestly to metrics-only (the numbers still show). No fake
// data, no dead buttons: everything here is driven by the live endpoint.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiBusinessApi } from '../api/posAiBusinessApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { growthCode } from './growthLabels';
type Ask = {
  ok: boolean; needsClarification: boolean; intent: string | null; toolUsed: string | null;
  answer: string | null; structured: any | null;
  access: { allowed: boolean; reason: string; label: string } | null;
  suggestions?: string[]; usage?: unknown;
};

type Saved = {
  id: string; title: string; intent: string; preset: string | null; comparePreset: string | null;
  question: string | null; sharingScope: 'private' | 'tenant'; ownedByMe: boolean; createdAt: string; lastUsedAt: string | null;
};

const CHIPS: { label: string; intent: string }[] = [
  { get label() { return t('pos.summarize_today'); }, intent: 'daily_summary' },
  { get label() { return t('pos.why_did_revenue_change'); }, intent: 'explain_revenue' },
  { get label() { return t('pos.revenue_summary'); }, intent: 'revenue_summary' },
  { get label() { return t('pos.appointment_trends'); }, intent: 'appointments' },
  { get label() { return t('pos.compare_branches'); }, intent: 'compare_branches' },
  { get label() { return t('pos.customer_growth'); }, intent: 'customer_growth' },
  { get label() { return t('pos.technician_performance_2'); }, intent: 'technician_performance' },
];

// Whitelisted headline fields pulled from whichever tool answered — shown only when present (never fabricated).
function keyNumbers(s: any): { label: string; value: string }[] {
  if (!s || typeof s !== 'object') return [];
  const out: { label: string; value: string }[] = [];
  const push = (label: string, v: string) => out.push({ label, value: v });
  const rev = s.revenue && s.revenue.available ? s.revenue : s; // daily brief nests revenue
  if (typeof rev.netSalesCents === 'number') push(t('growth.metric.netSales'), money(rev.netSalesCents));
  if (typeof rev.averageTicketCents === 'number') push(t('growth.metric.averageTicket'), money(rev.averageTicketCents));
  if (typeof s.changeCents === 'number') push(t('growth.metric.change'), money(s.changeCents));
  if (typeof s.changePercent === 'number') push(t('growth.metric.change'), `${s.changePercent.toFixed(1)}%`);
  const f = s.funnel || s;
  if (typeof f.totalBookings === 'number') push(t('growth.metric.bookings'), String(f.totalBookings));
  if (typeof f.completed === 'number') push(t('growth.metric.completed'), String(f.completed));
  if (typeof s.newCustomers === 'number') push(t('growth.metric.newCustomers'), String(s.newCustomers));
  if (typeof s.returningCustomers === 'number') push(t('growth.metric.returning'), String(s.returningCustomers));
  if (typeof s.retentionRatePercent === 'number') push(t('growth.metric.retention'), `${s.retentionRatePercent}%`);
  if (typeof s.technicianCount === 'number') push(t('growth.metric.technicians'), String(s.technicianCount));
  if (Array.isArray(s.branches)) push(t('growth.metric.branches'), String(s.branches.length));
  return out;
}
const notesOf = (s: any): string[] => [...(Array.isArray(s?.notes) ? s.notes : []), ...(Array.isArray(s?.caveats) ? s.caveats : [])];
const freshnessOf = (s: any): string | null => s?.freshnessClass || s?.evidence?.freshnessClass || null;
const drilldownOf = (s: any): string | null => s?.drilldownRoute || s?.evidence?.drilldownRoute || null;

export function POSAiBusinessScreen() {
  const [period, setPeriod] = useState('today');
  const [question, setQuestion] = useState('');
  const [res, setRes] = useState<Ask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveTitle, setSaveTitle] = useState('');

  const ask = useCallback(async (body: { intent?: string; question?: string }) => {
    setLoading(true); setError(null);
    try { setRes(await posAiBusinessApi.ask({ ...body, preset: period }) as Ask); }
    catch (e: any) { setError(reportError(e, t('growth.noun.theBusinessAssistant'))); }
    finally { setLoading(false); }
  }, [period]);

  // Saved questions load on mount; a failure (e.g. missing permission) leaves the list empty, never breaks the screen.
  const loadSaved = useCallback(async () => {
    try { setSaved(await posAiBusinessApi.savedList() as Saved[]); } catch { setSaved([]); }
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const runSaved = useCallback(async (q: Saved) => {
    setSaveTitle('');
    await ask({ intent: q.intent, question: q.question || undefined });
    posAiBusinessApi.savedUse(q.id).then(loadSaved).catch(() => { /* touch is best-effort */ });
  }, [ask, loadSaved]);

  const saveCurrent = useCallback(async () => {
    if (!res?.intent) return;
    const title = saveTitle.trim() || (question.trim() || growthCode(res.intent, 'aiIntent'));
    try { await posAiBusinessApi.savedCreate({ title, intent: res.intent, preset: period, question: question.trim() || undefined }); setSaveTitle(''); await loadSaved(); }
    catch (e: any) { setError(reportError(e, t('growth.noun.savingTheQuestion'))); }
  }, [res, saveTitle, question, period, loadSaved]);

  const deleteSaved = useCallback(async (id: string) => {
    try { await posAiBusinessApi.savedDelete(id); await loadSaved(); } catch { /* ignore */ }
  }, [loadSaved]);

  const s = res?.structured;
  const nums = keyNumbers(s);
  const notes = notesOf(s);
  const fresh = freshnessOf(s);
  const drill = drilldownOf(s);

  return (
    <div className="work">
      <div className="vh  ">
        <h1>{t('pos.ai_business_assistant')}</h1>
        <div className="sub mb-3">{t('pos.ask_about_revenue_appointments_customers_technicians_vko6')}</div>
      </div>
      <PeriodTabs period={period} onChange={setPeriod} />

      <div className="panel" style={{ marginTop: 12, padding: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {CHIPS.map((c) => (
            <button className="ghost btn w-fit whitespace-nowrap" key={c.intent}  onClick={() => ask({ intent: c.intent })} disabled={loading}>{c.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            className="in" style={{ flex: 1 }} placeholder={t('pos.ask_a_business_question')} value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && question.trim()) ask({ question: question.trim() }); }}
          />
          <button className="btn w-fit whitespace-nowrap" onClick={() => question.trim() && ask({ question: question.trim() })} disabled={loading || !question.trim()}>{t('pos.ask')}</button>
        </div>
      </div>

      {saved.length > 0 && (
        <div className="panel" style={{ marginTop: 12, padding: 14 }}>
          <div className="p-h" style={{ padding: 0, marginBottom: 8 }}>{t('pos.saved_questions')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {saved.map((q) => (
              <span key={q.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => runSaved(q)} disabled={loading} style={{ all: 'unset', cursor: 'pointer' }} title={q.sharingScope === 'tenant' ? t('pos.shared_with_your_team') : t('growth.aiBusiness.private')}>
                  {q.title}{q.sharingScope === 'tenant' ? t('pos.shared_2') : ''}
                </button>
                {q.ownedByMe && (
                  <button onClick={() => deleteSaved(q.id)} aria-label={t('pos.delete_title', { title: String(q.title) })} title={t('pos.delete')} style={{ all: 'unset', cursor: 'pointer', color: 'var(--muted)' }}>×</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {loading ? <div className="state" style={{ marginTop: 12 }}>{t('pos.thinking')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : !res ? <div className="state" style={{ marginTop: 12 }}>{t('pos.pick_a_question_above_or_type_vae9')}</div>
        : res.needsClarification ? (
          <div className="panel" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ marginBottom: 8 }}>{t('pos.which_would_you_like')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(res.suggestions || []).map((sug) => (
                <button key={sug} className="chip" onClick={() => ask({ question: sug })}>{sug}</button>
              ))}
            </div>
          </div>
        ) : (
        <>
          {res.ok === false && (
            <div className="err" style={{ marginTop: 12 }}>
              {t('pos.ai_explanation_is_unavailable')}{res.access?.label || t('pos.not_available_3')}{t('pos.showing_the_numbers_only')}
            </div>
          )}
          {res.answer && (
            <section className="panel" style={{ marginTop: 12, padding: 14 }}>
              <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('pos.answer')}</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{res.answer}</div>
            </section>
          )}

          {res.intent && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input
                className="in" style={{ flex: 1, maxWidth: 320 }} placeholder={t('pos.name_this_question_to_save_it')}
                value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent(); }}
              />
              <button className="btn  w-fit whitespace-nowrap" onClick={saveCurrent}>{t('pos.save_question')}</button>
            </div>
          )}

          {nums.length > 0 && (
            <div className="kpis" style={{ marginTop: 12 }}>
              {nums.map((n) => (<div className="kpi" key={n.label}><div className="l">{n.label}</div><div className="v">{n.value}</div></div>))}
            </div>
          )}

          {(fresh || drill) && (
            <div className="sub" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
              {fresh && <span>{t('pos.data_freshness')}{' '}{statusLabel('freshness', fresh)}</span>}
              {drill && <Link to={drill} style={{ color: 'var(--aps-orange)' }}>{t('pos.view_the_supporting_report')}</Link>}
            </div>
          )}

          {notes.length > 0 && (
            <ul className="sub" style={{ marginTop: 10, paddingLeft: 18 }}>
              {notes.map((n, i) => (<li key={i} style={{ marginBottom: 4 }}>{n}</li>))}
            </ul>
          )}

          {s != null && (
            <details style={{ marginTop: 12 }}>
              <summary className="sub" style={{ cursor: 'pointer' }}>{t('pos.show_all_returned_data')}</summary>
              <pre className="panel" style={{ marginTop: 8, padding: 12, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(s, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
