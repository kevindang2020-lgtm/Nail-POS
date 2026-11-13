// AiRecommendationsPanel.tsx — AI Receptionist Settings 07 (extras, Nov 13 2026): the salon-side approval screen for the AI
// Receptionist's configuration recommendations (the voice learning loop). Nothing here changes a live call: approving a prompt
// recommendation saves a DRAFT prompt version that platform support activates separately; FAQ / knowledge recommendations
// are marked approved for follow-up; operational targets (prices, hours, policies, permissions) are refused by the server.
// Owners / managers with ai.manage decide; ai.use can read.
import { useCallback, useEffect, useState } from 'react';
import type { AiRecommendation, AiRecommendationList } from '@aipowersalon/api-contracts/tenant';
import { posAiApi } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';
import { codeLabel } from '../components/codeLabel';
import { useCan } from '../components/usePermissions';

const STATUSES = ['open', 'approved', 'rejected', 'applied'] as const;
const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#A96F22', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

export function AiRecommendationsPanel() {
  const can = useCan(); const canDecide = can('ai.manage');
  const [status, setStatus] = useState<string>('open');
  const [data, setData] = useState<AiRecommendationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [body, setBody] = useState('');

  const load = useCallback(() => {
    setError(null);
    posAiApi.aiRecommendations(status).then(setData, (e) => setError(errorTextOf(e, t('aist.rec.loadFailed'))));
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function decide(r: AiRecommendation, action: 'approve' | 'reject') {
    setBusy(r.id); setError(null); setNotice(null);
    try {
      const out = action === 'approve' ? await posAiApi.approveAiRecommendation(r.id, r.targetType === 'prompt' ? body : undefined) : await posAiApi.rejectAiRecommendation(r.id);
      setNotice(action === 'reject' ? t('aist.rec.rejected') : out.draftVersionLabel ? t('aist.rec.approvedDraft', { label: out.draftVersionLabel }) : t('aist.rec.approved'));
      setEditing(null); setBody(''); load();
    } catch (e) { setError(errorTextOf(e, t('aist.rec.decideFailed'))); }
    finally { setBusy(null); }
  }

  return (
    <section style={cardBox} data-testid="aist-recs">
      <div style={{ ...headStyle, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{t('aist.rec.title')}</span>
        {data ? <span className="chip warn" data-testid="aist-recs-open">{t('aist.rec.openCount', { n: data.openCount })}</span> : null}
        <select aria-label={t('aist.rec.filter')} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="aist-recs-filter" style={{ marginLeft: 'auto' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{codeLabel('aist.rec.status', s)}</option>)}
        </select>
      </div>
      <div className="sub" style={{ marginBottom: 8 }}>{t('aist.rec.rule')}</div>
      {notice ? <div className="state" role="status" data-testid="aist-recs-notice">{notice}</div> : null}
      {error ? <div className="err" role="alert" data-testid="aist-recs-error">{error}</div> : null}
      {!data ? (error ? null : <div className="sub">{t('pos.loading')}</div>) : data.items.length === 0 ? <div className="sub" data-testid="aist-recs-empty">{t('aist.rec.empty')}</div> : (
        <table className="tbl"><thead><tr><th>{t('aist.rec.col.when')}</th><th>{t('aist.rec.col.area')}</th><th>{t('aist.rec.col.reason')}</th><th>{t('aist.rec.col.detail')}</th><th>{t('aist.rec.col.status')}</th><th /></tr></thead>
          <tbody>{data.items.map((r) => (
            <tr key={r.id} data-testid={`aist-rec-${r.id}`}>
              <td>{fmtDateTime(r.createdMs)}</td>
              <td>{codeLabel('aist.rec.target', r.targetType)}</td>
              <td>{codeLabel('aist.rec.cat', r.category)}</td>
              <td style={{ maxWidth: 360 }}>{r.detail}
                {editing === r.id ? (
                  <div style={{ marginTop: 6 }}>
                    <textarea aria-label={t('aist.rec.promptLabel')} data-testid="aist-rec-body" rows={4} style={{ width: '100%' }} value={body} onChange={(e) => setBody(e.target.value)} />
                    <div className="sub">{t('aist.rec.draftNote')}</div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                      <button className="btn" disabled={busy === r.id || !body.trim()} onClick={() => decide(r, 'approve')} data-testid="aist-rec-save-draft">{t('aist.rec.saveDraft')}</button>
                      <button style={linkBtn} onClick={() => { setEditing(null); setBody(''); }}>{t('pos.cancel')}</button>
                    </div>
                  </div>) : null}
              </td>
              <td>{codeLabel('aist.rec.status', r.status)}</td>
              <td>{r.status === 'open' && canDecide && editing !== r.id ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={linkBtn} disabled={busy === r.id} data-testid="aist-rec-approve" onClick={() => (r.targetType === 'prompt' ? (setEditing(r.id), setBody('')) : decide(r, 'approve'))}>{t('aist.rec.approve')}</button>
                  <button style={linkBtn} disabled={busy === r.id} data-testid="aist-rec-reject" onClick={() => decide(r, 'reject')}>{t('aist.rec.reject')}</button>
                </div>) : null}</td>
            </tr>))}</tbody></table>)}
      {!canDecide ? <div className="sub" data-testid="aist-recs-readonly">{t('aist.rec.readOnly')}</div> : null}
    </section>
  );
}
