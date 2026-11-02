// InsightDetailsDrawer — the full view of a single AI insight (§27). Shows evidence context, confidence AND its
// method (never presented as guaranteed accuracy), model + prompt version (preserved, never overwritten), data
// freshness, and the recommendation. RECOMMENDATIONS ONLY: the review/dismiss actions change the insight's own state
// and never execute an operational action. Does not expose chain-of-thought, hidden prompts, or provider secrets.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminApi, type AiInsightDetail } from '../api/superAdminApi';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const confBand = (c: number | null): string => (c == null ? 'Not Available' : c >= 90 ? 'Very High' : c >= 75 ? 'High' : c >= 50 ? 'Moderate' : c >= 25 ? 'Low' : 'Insufficient');
const freshTone = (f: string) => (f === 'current' ? 'ok' : f === 'stale' || f === 'expired' || f === 'source_unavailable' ? 'bad' : 'warn');

export function InsightDetailsDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: string) => void }) {
  const [d, setD] = useState<AiInsightDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null); setD(null);
    superAdminApi.aiInsight(id).then((r) => { if (r.ok && r.insight) setD(r.insight); else setErr((r.errors || ['Insight not found.']).join(' ')); }).catch((e: any) => setErr(e?.message || 'Failed to load.'));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const { ask, askUi } = useInlineAsk();

  const review = async () => { await superAdminApi.reviewInsights([id]); onChanged('Insight marked reviewed — a review was recorded (the recommendation was not accepted or executed).'); };
  const dismiss = () => ask('Dismiss this insight? A reason is required (insight + evidence are preserved):', async (reason) => {
    const r = await superAdminApi.dismissInsight(id, reason);
    onChanged(r.ok ? 'Insight dismissed and preserved in history.' : (r.errors || ['Could not dismiss.']).join(' '));
  });

  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F3ECE1' }}>
      <span className="muted">{label}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );

  return (
    <>
      {askUi}
    <div role="dialog" aria-modal="true" aria-label="Insight details" style={{ position: 'fixed', inset: 0, background: 'rgba(42,32,24,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 60 }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(460px, 96vw)', height: '100vh', overflowY: 'auto', background: '#fff', borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="phead"><h2>Insight Details</h2><button className="linkbtn" onClick={onClose} aria-label="Close">✕</button></div>
        {err ? <div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div>
          : !d ? <div className="state">Loading…</div>
          : (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{d.title}</div>
              <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{d.insightReference}</div>
              {d.summary ? <div style={{ fontSize: 12.5, marginBottom: 10 }}>{d.summary}</div> : null}

              <Field label="Category" value={cap(d.category)} />
              <Field label="Severity" value={<span className={'pill ' + (d.severity === 'critical' ? 'bad' : d.severity === 'low' ? 'ok' : 'warn')}>{cap(d.severity)}</span>} />
              <Field label="Confidence" value={d.confidence == null ? 'Not Available' : `${d.confidence}% · ${confBand(d.confidence)}`} />
              <Field label="Confidence method" value={d.confidenceMethod ? cap(d.confidenceMethod) : '—'} />
              <Field label="Status" value={cap(d.status)} />
              <Field label="Tenant" value={d.tenantName || '—'} />
              <Field label="Branch" value={d.branchName || '—'} />
              {d.churnRiskScore != null ? <Field label="Churn risk score" value={`${d.churnRiskScore}% (predicted, not confirmed)`} /> : null}
              {d.flaggedAmountCents != null ? <Field label="Flagged amount" value={`$${(d.flaggedAmountCents / 100).toLocaleString()} — flagged for review, not confirmed fraud`} /> : null}
              <Field label="Generated" value={new Date(d.generatedAt).toLocaleString()} />
              <Field label="Last evaluated" value={new Date(d.lastEvaluatedAt).toLocaleString()} />
              <Field label="Data freshness" value={<span className={'pill ' + freshTone(d.freshness)}>{cap(d.freshness)}</span>} />
              <Field label="Model" value={`${d.modelProvider || '—'} · ${d.modelName || '—'}`} />
              <Field label="Model version" value={d.modelVersion || '—'} />
              <Field label="Prompt version" value={d.promptVersion || '—'} />

              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700 }}>Recommendation</div>
              <div style={{ fontSize: 12.5 }}>{d.recommendation || '—'}</div>

              <div className="panel" style={{ marginTop: 12, borderLeft: '4px solid #3B82C4', background: '#EFF6FC', fontSize: 11.5 }}>
                This is a recommendation only. To act on it, open the relevant operational module — the action requires the right permission, confirmation, and is attributed to you, not to AI.
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn ghost" onClick={review}>Mark Reviewed</button>
                <button className="btn ghost" onClick={dismiss}>Dismiss</button>
              </div>
            </>
          )}
      </div>
    </div>
    </>
  );
}
