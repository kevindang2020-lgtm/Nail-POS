import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posSkillRequestsApi, type PendingSkillRequest } from '../api/posSkillRequestsApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(displayLocale(), { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(displayLocale(), { hour: 'numeric', minute: '2-digit' });
};

const ipt: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' };
const cardStyle: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '16px', marginBottom: '12px' };

// Decision 7 — DRAFT -> SUBMITTED -> UNDER_REVIEW -> MORE_INFORMATION_REQUIRED -> APPROVED / REJECTED. 'pending' is the
// pre-migration-475 name for submitted. The server checks every move; the buttons below only offer the allowed ones.
const AWAITING_REVIEWER = ['submitted', 'pending', 'under_review'];
const canStartReview = (st: string) => st === 'submitted' || st === 'pending';
const canAskMoreInfo = (st: string) => st === 'submitted' || st === 'pending' || st === 'under_review';

export function POSSkillRequestsScreen() {
  const [items, setItems] = useState<PendingSkillRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [selectedReq, setSelectedReq] = useState<PendingSkillRequest | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const load = useCallback(
    () => posSkillRequestsApi.pending().then((d) => { setItems(d); setError(null); }).catch((e: any) => setError(e?.message || t('pos.failed_to_load_skill_requests'))),
    [],
  );
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: any) => {
    setBusy(id + decision); setNote(null); setError(null);
    try {
      const res = await posSkillRequestsApi.decide(id, decision, decisionNotes[id]);
      setNote(t('pos.v0_marked_as_v1_for_servicename', { v0: String(res.technicianName || 'Technician'), v1: statusLabel('skillRequest', decision).toLowerCase(), serviceName: String(res.serviceName) }));
      setDecisionNotes((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setSelectedReq(null);
      await load();
    } catch (e: any) { setError(e?.message || t('pos.action_failed')); }
    finally { setBusy(null); }
  };

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = items ? items.slice(indexOfFirstItem, indexOfLastItem) : null;
  const totalPages = items ? Math.ceil(items.length / itemsPerPage) : 0;

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between">
        <div className="vh">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0 }}>{t('pos.skill_change_requests')}</h1>
            {items ? <span className="pill" style={{ background: '#E9F1FA', color: '#2C6BB0' }}>{items.filter((i) => AWAITING_REVIEWER.includes(i.status)).length} {t('pos.pending')}</span> : null}
          </div>
          <div className="sub" style={{ marginTop: 4 }}>{t('pos.approving_an_add_makes_the_technician_xg0r')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" onClick={() => load()}>{t('pos.refresh')}</button>
        </div>
      </div>
      
      {note ? <div className="err" style={{ background: '#F3F8F4', borderColor: '#BFE3C6', color: '#2F6B43', marginBottom: 16 }} role="status">{note}</div> : null}
      {error ? <div className="err" style={{ marginBottom: 16 }}>{error}</div> : null}
        
      <section className="panel" style={{ padding: '20px' }}>
        {!currentItems ? (
          <div className="state">{t('pos.loading')}</div>
        ) : currentItems.length === 0 ? (
          <div className="state">{t('pos.no_pending_skill_requests')}</div>
        ) : (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {currentItems.map((q) => (
                <div key={q.id} style={{ ...cardStyle, cursor: 'pointer', transition: 'box-shadow 0.2s', ':hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)' } } as any} onClick={() => setSelectedReq(q)}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    
                  <div className="flex flex-col gap-3 sm:flex-row items-start justify-between">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <ProfileAvatarWithPreview name={q.technicianName || 'Technician'} url={(q as any).avatarUrl} size={32} type="technician" />
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{q.technicianName || t('pos.technician')}</span>
                          <span className="pill" style={{ textTransform: 'capitalize', background: ['approved', 'rejected'].includes(q.status) ? (q.status === 'approved' ? '#E7F4EA' : '#FBEAE8') : '#FDEFE0', color: ['approved', 'rejected'].includes(q.status) ? (q.status === 'approved' ? '#2E7D32' : '#C0392B') : '#C26A12' }}>
                            {statusLabel('skillRequest', q.status)}
                          </span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
                          <span className={q.requestType === 'add' ? 'pill ok' : 'pill warn'} style={{ fontWeight: 700 }}>
                            {q.requestType === 'add' ? 'ADD' : t('pos.remove_2')}
                          </span>
                          <span style={{ fontWeight: 600 }}>{q.serviceName}</span>
                          <span className="muted">·</span>
                          <span className="muted">{when(q.createdAt)}</span>
                        </div>
                      </div>
                      
                      <button className="btn outline" style={{ fontSize: 12, padding: '4px 12px', height: 32 }} onClick={(e) => { e.stopPropagation(); setSelectedReq(q); }}>{t('pos.review_request')}</button>
                    </div>

                    {['approved', 'rejected'].includes(q.status) && (
                       <div style={{ marginTop: 4, padding: '8px 12px', background: '#FBF5EA', borderRadius: 8, fontSize: 12.5, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                         <span style={{ color: q.status === 'approved' ? '#2E7D32' : '#C0392B', fontWeight: 700 }}>✓</span>
                         {t('pos.this_request_was')}{' '}<span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{statusLabel('skillRequest', q.status)}</span>.
                       </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 4 }}>
                <div className="s muted">
                  {t('pos.showing')}{' '}{indexOfFirstItem + 1} {t('pos.to')}{' '}{Math.min(indexOfLastItem, items!.length)} {t('pos.of')}{' '}{items!.length} {t('pos.requests_2')}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <button 
                    className="btn ghost" 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    style={{ padding: '4px 10px' }}
                  >
                    {t('pos.prev_2')}
                  </button>
                  <button 
                    className="btn ghost" 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    style={{ padding: '4px 10px' }}
                  >
                    {t('pos.next_3')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Review Modal */}
      {selectedReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', borderRadius: 14, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{t('pos.review_skill_request')}</h2>
              <button className="btn ghost" onClick={() => setSelectedReq(null)}>✕</button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px', background: '#F8F9FA', borderRadius: 8 }}>
              <ProfileAvatarWithPreview name={selectedReq.technicianName || 'Technician'} url={(selectedReq as any).avatarUrl} size={48} type="technician" />
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedReq.technicianName || t('pos.technician')}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('pos.submitted')}{' '}{when(selectedReq.createdAt)}</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>{t('pos.request_details')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.skill_service')}</div>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                     <span className={selectedReq.requestType === 'add' ? 'pill ok' : 'pill warn'} style={{ fontWeight: 700, padding: '2px 6px', fontSize: 11 }}>
                      {selectedReq.requestType === 'add' ? 'ADD' : t('pos.remove_2')}
                     </span>
                     {selectedReq.serviceName}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.status')}</div>
                  <span className="pill" style={{ textTransform: 'capitalize', background: ['approved', 'rejected'].includes(selectedReq.status) ? (selectedReq.status === 'approved' ? '#E7F4EA' : '#FBEAE8') : '#FDEFE0', color: ['approved', 'rejected'].includes(selectedReq.status) ? (selectedReq.status === 'approved' ? '#2E7D32' : '#C0392B') : '#C26A12' }}>
                    {statusLabel('skillRequest', selectedReq.status)}
                  </span>
                </div>
                
                {selectedReq.proficiencyLevel && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.proficiency')}</div>
                    <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{selectedReq.proficiencyLevel}</div>
                  </div>
                )}
                {selectedReq.experienceYears != null && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.experience')}</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedReq.experienceYears} {t('pos.years')}</div>
                  </div>
                )}
              </div>
            </div>

            {selectedReq.note && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>{t('pos.technician_notes')}</div>
                <div style={{ background: '#FBF5EA', padding: 16, borderRadius: 8, fontSize: 14, color: 'var(--text)' }}>"{selectedReq.note}"</div>
              </div>
            )}

            {((selectedReq.supportingPhotos && selectedReq.supportingPhotos.length > 0) || selectedReq.certificateEvidence) && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>{t('pos.attached_evidence')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid var(--line)', borderRadius: 8 }}>
                  {selectedReq.certificateEvidence && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', background: '#F8F9FA', borderRadius: 8 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: '#EAECEF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📄</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{t('pos.certificate_document')}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.pdf_document')}</div>
                      </div>
                      <a href={safeHref(selectedReq.certificateEvidence)} target="_blank" rel="noopener noreferrer" className="btn outline" style={{ height: 32, fontSize: 12 }}>{t('pos.view_document')}</a>
                    </div>
                  )}
                  {selectedReq.supportingPhotos && selectedReq.supportingPhotos.length > 0 && (
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('pos.supporting_photos')}{selectedReq.supportingPhotos.length})</div>
                      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
                        {selectedReq.supportingPhotos.filter((photo: string) => safeHref(photo) !== undefined).map((photo: string, i: number) => (
                          <a key={i} href={photo} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                            <img src={photo} alt={t('pos.evidence')} style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {selectedReq.reviewNotes ? <div style={{ padding: '8px 12px', background: '#FBF5EA', borderRadius: 8, fontSize: 13 }}><b>{t('pos.reviewer_notes')}</b> {selectedReq.reviewNotes}</div> : null}

            {!['approved', 'rejected'].includes(selectedReq.status) && (
              <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase' }}>{t('pos.review_decision')}</div>
                <input 
                  type="text" 
                  style={{ ...ipt, width: '100%', marginBottom: 12 }} 
                  placeholder={t('pos.notes_for_the_technician_required_for_qc39')} 
                  value={decisionNotes[selectedReq.id] || ''} 
                  onChange={(e) => setDecisionNotes({ ...decisionNotes, [selectedReq.id]: e.target.value })} 
                />
                {selectedReq.status === 'more_information_required' ? <div className="s muted" style={{ marginBottom: 10 }}>{t('pos.waiting_for_the_technician_to_add_um7t')}</div> : null}
                {(canStartReview(selectedReq.status) || canAskMoreInfo(selectedReq.status)) && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    {canStartReview(selectedReq.status) && (
                      <button className="btn ghost" style={{ flex: 1, height: 40 }} disabled={!!busy} onClick={() => decide(selectedReq.id, 'under_review')}>
                        {busy === selectedReq.id + 'under_review' ? t('pos.starting_2') : t('pos.start_review_2')}
                      </button>
                    )}
                    {canAskMoreInfo(selectedReq.status) && (
                      <button className="btn ghost" style={{ flex: 1, height: 40 }} disabled={!!busy || !(decisionNotes[selectedReq.id] || '').trim()} title={t('pos.write_what_the_technician_needs_to_1yao')} onClick={() => decide(selectedReq.id, 'more_information_required')}>
                        {busy === selectedReq.id + 'more_information_required' ? t('pos.sending_2') : t('pos.request_more_info')}
                      </button>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12 }}>
                  <button 
                    className="btn" 
                    style={{ flex: 1, height: 44, background: '#2E7D32', borderColor: '#2E7D32', color: '#fff', fontSize: 15 }} 
                    disabled={!!busy} 
                    onClick={() => decide(selectedReq.id, 'approved')}
                  >
                    {busy === selectedReq.id + 'approved' ? t('pos.approving_2') : t('pos.approve_request')}
                  </button>
                  <button 
                    className="btn outline" 
                    style={{ flex: 1, height: 44, borderColor: '#C0392B', color: '#C0392B', fontSize: 15 }} 
                    disabled={!!busy} 
                    onClick={() => decide(selectedReq.id, 'rejected')}
                  >
                    {busy === selectedReq.id + 'rejected' ? t('pos.rejecting') : t('pos.reject_request')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


/** Security Deep Scan D4: an evidence link renders only when it is https or a same-origin path (old rows included). */
export function safeHref(v: string | null | undefined): string | undefined {
  const s = String(v ?? '').trim();
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try { const u = new URL(s); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; }
}
