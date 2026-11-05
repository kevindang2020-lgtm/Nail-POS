// POSAICustomerDuplicateReviewScreen.tsx — AI Center → AI Customer Profile → Duplicate Review (§16/§47).
// Lists duplicate candidate groups, lets the user choose a surviving record, PREVIEW what will move, then CONFIRM a
// merge. Never auto-merges. The merge calls the existing customers.merge service (requires pos.customers.merge); a 403
// surfaces as an inline permission message. No browser alerts.
import { useCallback, useEffect, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { ConfidenceChip, Loading, Empty, ErrorBox, Freshness, profileError, DASH } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function POSAICustomerDuplicateReviewScreen() {
  const [groups, setGroups] = useState<any[]>([]);
  const [fresh, setFresh] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // merge dialog state
  const [preview, setPreview] = useState<any>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [deciding, setDeciding] = useState<string | null>(null);
  const decide = async (groupId: string, decision: 'keep_separate' | 'not_sure') => {
    setDeciding(groupId);
    try { await posCustomersApi.decideDuplicate(groupId, decision); await load(); } catch { /* the group stays as it was; nothing merged */ }
    finally { setDeciding(null); }
  };
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await apiP.duplicates(); setGroups(r.groups || []); setFresh(r.freshness); }
    catch (e: any) { setError(profileError(e, t('growth.noun.duplicateCandidates'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openPreview = useCallback(async (groupId: string, primaryCustomerId: string) => {
    setPreview({ loading: true, groupId, primaryCustomerId }); setPreviewErr(null);
    try { setPreview(await apiP.mergePreview(groupId, primaryCustomerId)); }
    catch (e: any) { setPreview(null); setPreviewErr(profileError(e, t('growth.noun.thisMergePreview'))); }
  }, []);

  const confirmMerge = useCallback(async () => {
    if (!preview) return;
    setMerging(true); setPreviewErr(null);
    try {
      await apiP.merge(preview.groupId, preview.survivingRecord.customerId);
      setPreview(null); setNotice(t('growth.aiProfile.merged'));
      await load();
    } catch (e: any) { setPreviewErr(profileError(e, t('growth.noun.thisMerge'))); }
    finally { setMerging(false); }
  }, [preview, load]);

  return (
    <div className="work">
      <div className="vh"><h1>{t('pos.duplicate_review')}</h1>
        <div className="sub mb-3">{t('pos.possible_duplicate_customer_records_review_and_p8cc')}</div></div>

      {notice && <div className="panel" role="status" style={{ padding: 12, marginBottom: 10, color: 'var(--aps-orange)' }}>{notice}</div>}

      {loading ? <Loading label={t('pos.scanning_for_duplicate_records')} />
        : error ? <ErrorBox message={error} onRetry={load} />
        : groups.length === 0 ? <Empty label={t('pos.no_duplicate_candidates_your_customer_records_8r5c')} />
        : (
        <>
          {groups.map((g) => (
            <section className="panel" key={g.duplicateGroupId} style={{ marginTop: 12, padding: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <strong>{t('pos.possible_duplicate')}</strong><ConfidenceChip level={g.confidence} /><span className="sub" style={{ fontSize: 12 }}>{g.reason}</span>
                {g.notSure ? <span className="chip" style={{ fontSize: 11 }}>{t('pos.marked_not_sure')}</span> : null}
                {/* Functional Decision 29: Merge / Keep Separate / Not Sure — never an automatic merge */}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="seg-btn" disabled={deciding === g.duplicateGroupId} onClick={() => void decide(g.duplicateGroupId, 'keep_separate')}>{t('pos.keep_separate')}</button>
                  {!g.notSure ? <button className="seg-btn" disabled={deciding === g.duplicateGroupId} onClick={() => void decide(g.duplicateGroupId, 'not_sure')}>{t('pos.not_sure')}</button> : null}
                </span>
              </div>
              <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
                <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.phone')}</th><th>{t('pos.email')}</th><th style={{ textAlign: 'right' }}>{t('pos.visits')}</th><th >{t('pos.keep_this_one')}</th></tr></thead>
                <tbody>{g.members.map((m: any) => (
                  <tr key={m.customerId}>
                    <td>{m.displayName || DASH}</td>
                    <td style={{ color: 'var(--muted)' }}>{m.phone || DASH}</td>
                    <td style={{ color: 'var(--muted)' }}>{m.email || DASH}</td>
                    <td style={{ textAlign: 'right' }}>{m.visitCount ?? DASH}</td>
                    <td><button className="seg-btn" onClick={() => openPreview(g.duplicateGroupId, m.customerId)}>{t('pos.merge_into_this')}</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
          ))}
          <div style={{ marginTop: 8 }}><Freshness f={fresh} /></div>
        </>
      )}

      {/* confirmation dialog (not a browser alert) */}
      {(preview || previewErr) && (
        <div role="dialog" aria-modal="true" aria-label={t('pos.confirm_merge')}
          style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,15,.35)', display: 'grid', placeItems: 'center', zIndex: 50 }}
          onClick={() => { if (!merging) { setPreview(null); setPreviewErr(null); } }}>
          <div className="panel" style={{ width: 'min(560px, 92vw)', padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{t('pos.confirm_merge')}</h2>
            {previewErr ? <ErrorBox message={previewErr} />
              : preview?.loading ? <Loading label={t('pos.preparing_preview')} />
              : preview ? (
              <>
                <p className="sub" style={{ marginTop: 0 }}>{t('pos.the_surviving_record_keeps_everything_the_4e4j')}</p>
                <div style={{ margin: '10px 0' }}>
                  <div><strong>{t('pos.keep')}</strong> {preview.survivingRecord.displayName} <span className="sub">({preview.survivingRecord.phone || DASH})</span></div>
                  <div style={{ marginTop: 4 }}><strong>{t('pos.merge_archive')}</strong> {preview.mergingRecords.map((m: any) => m.displayName).join(', ') || DASH}</div>
                </div>
                <div className="sub">{t('pos.moves_to_the_surviving_profile')}{' '}{preview.willMove.join(', ')}.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button className="seg-btn" onClick={() => setPreview(null)} disabled={merging}>{t('pos.cancel')}</button>
                  <button className="seg-btn on" onClick={confirmMerge} disabled={merging}>{merging ? t('pos.merging') : t('pos.merge_records')}</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
