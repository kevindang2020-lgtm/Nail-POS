// POSAIMoneyProtectionAlertsScreen.tsx — AI Center → AI Money Protection → Alerts. Wired to
// GET /pos/ai-money-protection/alerts (ai_money_protection.view_alerts) and POST …/alerts/:id/explain
// (advisory, sanitized server-side). Read/advisory only: it never refunds, voids, or accuses. Every alert shows
// its evidence, alternative explanations, and a "requires review" framing.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { reportError, money } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
import { codedText } from '../i18n/coded-text';
import { mpTextCoded } from '@aipowersalon/api-contracts/tenant';
import type { CodedText } from '@aipowersalon/api-contracts';
import { getLanguage } from '@aipowersalon/mobile-sdk/i18n';
type Alert = {
  id: string; severity: string; alertType: string; status: string; amountCents: number; riskScore: number;
  confidence: string; createdAt: string; branchId: string | null;
  evidence: { summary: string; triggeredRules: string[]; recommendedReview?: string[]; alternativeExplanations?: string[]; currentValues?: Record<string, unknown>; baselineValues?: Record<string, unknown>; differences?: Record<string, unknown>; dataFreshness?: string };
  related: { transactionIds?: string[]; ticketIds?: string[]; userIds?: string[] };
};
type Explanation = { summary: string; source: 'ai' | 'fallback'; disclaimer: string; summaryCoded?: CodedText[] | null; disclaimerCoded?: CodedText | null; language?: 'en' | 'vi' | null };

const SEVERITIES = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const label = (t: string) => growthCode(t, 'aiMoneyProtection');
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const sevColor = (s: string) => s === 'CRITICAL' ? 'var(--danger, #b3261e)' : s === 'HIGH' ? '#c2410c' : s === 'MEDIUM' ? 'var(--gold, #A96F22)' : 'var(--muted)';

export function POSAIMoneyProtectionAlertsScreen() {
  const [rows, setRows] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [explain, setExplain] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [invMsg, setInvMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIMoneyProtectionApi.alerts({ severity: severity || undefined }) as { items: Alert[] }; if (alive) setRows(d.items || []); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.moneyProtection'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [severity]);

  const openDetail = (a: Alert) => { setSelected(a); setExplain(null); setInvMsg(null); };
  const runExplain = async () => {
    if (!selected) return;
    setExplaining(true);
    try { setExplain(await posAIMoneyProtectionApi.explainAlert(selected.id) as Explanation); }
    catch (e: any) { setExplain({ summary: reportError(e, tx('growth.noun.explanation')), source: 'fallback', disclaimer: '' }); }
    finally { setExplaining(false); }
  };
  const openInvestigation = async () => {
    if (!selected) return;
    setInvMsg(null);
    try {
      const inv = await posAIMoneyProtectionApi.createInvestigation({ title: tx('pos.alerttype_review', { alertType: String(label(selected.alertType)) }), alertIds: [selected.id] }) as { id: string };
      setInvMsg(tx('growth.moneyProtection.investigationOpened', { id: String(inv.id) }));
    } catch (e: any) { setInvMsg(reportError(e, tx('growth.noun.openInvestigation'))); }
  };

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.money_protection_alerts')}</h1>
        <div className="sub mb-3">{tx('pos.possible_anomalies_requiring_review_each_shows_1ql7')}</div>
      </div>

      <div className="seg" style={{ marginBottom: 10 }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>{tx('pos.severity')}</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={tx('pos.filter_by_severity')}>
          {SEVERITIES.map((s) => <option key={s || 'all'} value={s}>{s || tx('pos.all')}</option>)}
        </select>
      </div>

      {loading ? <div className="state">{tx('pos.loading_alerts')}</div>
        : error ? <div className="err">{error}</div>
        : !rows || rows.length === 0 ? <div className="state">{tx('pos.no_alerts_match_nothing_needs_review_14gh')}</div>
        : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.severity_2')}</th><th>{tx('pos.type')}</th><th style={{ textAlign: 'right' }}>{tx('pos.under_review')}</th><th>{tx('pos.status')}</th><th>{tx('pos.created')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><span style={{ fontWeight: 700, color: sevColor(a.severity) }}>{growthCode(a.severity, 'level')}</span></td>
                  <td>{label(a.alertType)}</td>
                  <td style={{ textAlign: 'right' }}>{a.amountCents > 0 ? money(a.amountCents) : '—'}</td>
                  <td>{label(a.status)}</td>
                  <td>{fmtDate(a.createdAt)}</td>
                  <td><button type="button" onClick={() => openDetail(a)}>{tx('pos.review')}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

      {selected && (
        <div className="panel" style={{ marginTop: 16 }} role="dialog" aria-label={tx('pos.alert_detail')}>
          <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
            <h2 style={{ fontSize: 16 }}>{label(selected.alertType)} · <span style={{ color: sevColor(selected.severity) }}>{growthCode(selected.severity, 'level')}</span></h2>
            <button type="button" onClick={() => setSelected(null)}>{tx('pos.close')}</button>
          </div>
          <p style={{ margin: '6px 0' }}>{codedText(mpTextCoded(selected.evidence.summary), selected.evidence.summary)}</p>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {tx('pos.risk_score')}{' '}{selected.riskScore} {tx('pos.confidence_2')}{' '}{selected.confidence} {tx('pos.value_under_review')}{' '}{selected.amountCents > 0 ? money(selected.amountCents) : '—'} {tx('pos.not_confirmed_loss')}
          </div>

          {(selected.evidence.recommendedReview?.length ?? 0) > 0 && (
            <><h3 style={{ fontSize: 14, marginTop: 12 }}>{tx('pos.recommended_review')}</h3>
              <ul>{selected.evidence.recommendedReview!.map((r, i) => <li key={i}>{codedText(mpTextCoded(r), r)}</li>)}</ul></>
          )}
          {(selected.evidence.alternativeExplanations?.length ?? 0) > 0 && (
            <><h3 style={{ fontSize: 14, marginTop: 8 }}>{tx('pos.possible_benign_explanations')}</h3>
              <ul>{selected.evidence.alternativeExplanations!.map((r, i) => <li key={i}>{codedText(mpTextCoded(r), r)}</li>)}</ul></>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={runExplain} disabled={explaining}>{explaining ? tx('pos.generating') : tx('pos.explain_this_alert_advisory')}</button>
            <button type="button" onClick={openInvestigation}>{tx('pos.open_investigation')}</button>
          </div>
          {invMsg && <div className="sub" style={{ marginTop: 8, color: 'var(--muted)' }}>{invMsg}</div>}
          {explain && (
            <div className="panel" style={{ marginTop: 10, background: 'var(--card, #fff)' }}>
              {/* Vietnamese POS §21 / §120: the deterministic summary — English: the server's text; Vietnamese: worded from its
                  codes. An AI-written summary is in the language the gateway asked for (the reader's POS language, `language`):
                  shown as is when it matches the screen, labelled with its language when it does not (switched mid-way) */}
              {explain.source === 'fallback'
                ? (getLanguage() === 'en' || !explain.summaryCoded?.length
                  ? <p style={{ margin: 0 }}>{explain.summary}</p>
                  : <p style={{ margin: 0 }}>{explain.summaryCoded!.map((c) => codedText(c)).join(' ')}</p>)
                : (explain.language ?? 'en') === getLanguage()
                  ? <p style={{ margin: 0 }} lang={explain.language ?? 'en'} data-testid="mp-explain-ai">{explain.summary}</p>
                  : (explain.language ?? 'en') === 'en'
                    ? <p style={{ margin: 0 }} lang="en" data-testid="mp-explain-ai-english"><b>{tx('growth.mp.aiEnglish')}</b> {explain.summary}</p>
                    : <p style={{ margin: 0 }} lang="vi" data-testid="mp-explain-ai-vietnamese"><b>{tx('growth.mp.aiVietnamese')}</b> {explain.summary}</p>}
              {explain.disclaimer && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{getLanguage() === 'en' ? explain.disclaimer : codedText(explain.disclaimerCoded ?? { code: 'MP.DISCLAIMER' }, explain.disclaimer)} {explain.source === 'fallback' ? tx('pos.deterministic_summary') : ''}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
