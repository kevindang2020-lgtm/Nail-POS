// POSAIReviewReputationSettingsScreen.tsx — tenant settings for the AI Review & Reputation Assistant. Enable/disable,
// response tone, approval requirement, the controlled auto-response policy (with its safety envelope shown plainly), and
// the post-visit review-request policy. Saving writes the tenant-level config; the server clamps the auto-response
// envelope regardless of what's sent (5-star only, high confidence, no complaint text).
import { useCallback, useEffect, useState } from 'react';
import { posAiReviewReputationApi as apiR } from '../api/posAiReviewReputationApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const TONES = ['professional', 'warm', 'luxury', 'friendly', 'concise', 'apologetic', 'brand'];

function Row({ label, hint, isLast, children }: { label: string; hint?: string; isLast?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '16px 20px', borderBottom: isLast ? 'none' : '1px solid var(--line)' }}>
      <div style={{ flex: '1 1 300px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{label}</div>
        {hint ? <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4, lineHeight: 1.4 }}>{hint}</div> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function POSAIReviewReputationSettingsScreen() {
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setS(await apiR.settings()); } catch (e: any) { setErr(e?.message || tx('pos.could_not_load_settings')); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const cfg = s?.config || {};
  const set = (patch: any) => setS({ ...s, config: { ...cfg, ...patch } });
  const setAuto = (patch: any) => setS({ ...s, config: { ...cfg, autoResponse: { ...(cfg.autoResponse || {}), ...patch } } });
  const setReq = (patch: any) => setS({ ...s, config: { ...cfg, reviewRequest: { ...(cfg.reviewRequest || {}), ...patch } } });

  const save = async () => {
    setBusy(true); setErr(null); setOk(false);
    try { const next = await apiR.updateSettings({ level: 'tenant', enabled: s.enabled, config: cfg }); setS(next); setOk(true); setTimeout(() => setOk(false), 2500); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_save_2')); } finally { setBusy(false); }
  };

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_settings')}</div></div>;

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.review_reputation_settings')}</h1>
          <div className="sub mb-3">{tx('pos.control_how_the_assistant_analyzes_reviews_sow4')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {ok ? <span style={{ color: 'var(--ok, #2E7D32)', fontSize: 13, fontWeight: 600 }}>{tx('pos.saved')}</span> : null}
          <button className="btn w-fit whitespace-nowrap" disabled={busy} onClick={() => void save()} style={{ height: 34, padding: '0 16px', fontSize: 13 }}>
            {busy ? tx('pos.saving_2') : tx('pos.save_changes')}
          </button>
        </div>
      </div>

      {err ? <div className="err" style={{ marginBottom: 16 }}>{err}</div> : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.assistant')}</div>
        <Row label={tx('pos.enable_the_assistant')} hint={tx('pos.turns_analysis_drafting_and_requests_on_aerb')}>
          <input type="checkbox" checked={!!s?.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </Row>
        <Row label={tx('pos.response_tone')}>
          <select className="in" value={cfg.responseTone || 'professional'} onChange={(e) => set({ responseTone: e.target.value })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13, minWidth: 140, outline: 'none', cursor: 'pointer' }}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Row>
        <Row label={tx('pos.require_approval_before_publishing')} hint={tx('pos.recommended_public_responses_wait_for_a_km03')} isLast>
          <input type="checkbox" checked={cfg.approvalRequired !== false} onChange={(e) => set({ approvalRequired: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </Row>
      </section>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>
          {tx('pos.controlled_auto_response')}
        </div>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 13, color: '#4B5563', lineHeight: 1.5, background: '#FFFDF9' }}>
          {tx('pos.off_by_default_when_on_the_fnkg')}
        </div>
        <Row label={tx('pos.enable_auto_response_for_clean_5_1jow')} isLast>
          <input type="checkbox" checked={!!cfg.autoResponse?.enabled} onChange={(e) => setAuto({ enabled: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </Row>
      </section>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '14px 20px', background: '#F9FAFB', borderBottom: '1px solid var(--line)', fontWeight: 600, fontSize: 14, color: '#111827' }}>{tx('pos.post_visit_review_requests')}</div>
        <Row label={tx('pos.send_a_review_request_after_a_1vc6')} hint={tx('pos.fair_to_all_customers_never_gates_1pyz')}>
          <input type="checkbox" checked={!!cfg.reviewRequest?.enabled} onChange={(e) => setReq({ enabled: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </Row>
        <Row label={tx('pos.channel')}>
          <select className="in" value={cfg.reviewRequest?.channel || 'sms'} onChange={(e) => setReq({ channel: e.target.value })} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13, minWidth: 100, outline: 'none', cursor: 'pointer' }}>
            {['sms', 'email', 'app'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Row>
        <Row label={tx('pos.delay_after_visit_minutes')}>
          <input type="number" className="in" min={0} value={cfg.reviewRequest?.delayMinutes ?? 120} onChange={(e) => setReq({ delayMinutes: Number(e.target.value) })} style={{ width: 80, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13, textAlign: 'center', outline: 'none' }} />
        </Row>
        <Row label={tx('pos.send_one_reminder')} hint={tx('pos.at_most_one_follow_up_if_1r8m')} isLast>
          <input type="checkbox" checked={!!cfg.reviewRequest?.oneReminder} onChange={(e) => setReq({ oneReminder: e.target.checked })} style={{ width: 18, height: 18, cursor: 'pointer' }} />
        </Row>
      </section>
    </div>
  );
}
