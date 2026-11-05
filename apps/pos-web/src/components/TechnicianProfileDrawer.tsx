// TechnicianProfileDrawer.tsx — P3 manager view of a technician's portable profile: hero + rating, photo
// moderation (approve/hide with status chips), reviews moderation (hide with reason — score never edited),
// memberships + Disconnect. Internal scroll only (Mac fit rule); cream/gold.
import { useCallback, useEffect, useState } from 'react';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { TechnicianAccessPanel } from './TechnicianAccessPanel';
import { TechnicianWorkforcePanel } from './TechnicianWorkforcePanel';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';

export function TechnicianProfileDrawer({ technicianId, displayName, onClose }: { technicianId: string; displayName: string; onClose: () => void }) {
  const [view, setView] = useState<any | null>(null);
  const [ratings, setRatings] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [eName, setEName] = useState(''); const [eTitle, setETitle] = useState(''); const [eBio, setEBio] = useState('');

  const load = useCallback(() => {
    Promise.all([posTechniciansApi.techProfile(technicianId), posTechniciansApi.profileRatings(technicianId)])
      .then(([v, r]: any[]) => { setView(v); setRatings(r.ratings); setError(null); })
      .catch((e: any) => setError(e?.message || t('pos.could_not_load_the_profile')));
  }, [technicianId]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); load(); } catch (e: any) { setError(e?.message || t('pos.action_failed')); } finally { setBusy(null); }
  };

  return (
    <div role="dialog" aria-label={t('pos.profile_displayname', { displayName: String(displayName) })} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(30,20,8,.28)', display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div className="no-scrollbar" onClick={(e) => e.stopPropagation()} style={{ width: 540, maxWidth: '94vw', height: '100vh', background: '#FFFFFF', borderLeft: '1px solid #EFEAE1', boxShadow: '-24px 0 80px rgba(0,0,0,0.08)', display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 32px 16px', borderBottom: '1px solid #EFEAE1', background: '#FAFAF9' }}>
          <strong style={{ fontSize: 16, fontFamily: '"Playfair Display",serif', fontWeight: 800, color: '#2C2A29' }}>{t('pos.technician_profile')}</strong>
          <button style={{ marginLeft: 'auto', background: '#FFFFFF', border: '1px solid #EFEAE1', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#8A7A6D', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#FDF0EE'; e.currentTarget.style.color = '#C0392B'; }} onMouseOut={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#8A7A6D'; }} onClick={onClose}>✕</button>
        </div>
        <div className="no-scrollbar" style={{ overflowY: 'auto', padding: '24px 32px 60px' }}>
          {error ? <div className="err" style={{ marginBottom: 10 }}>{error}</div> : null}
          {!view ? <div className="muted">{t('pos.loading')}</div> : !view.hasProfile ? (
            <div className="muted">{view.message}</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 24 }}>
                <ProfileAvatarWithPreview name={view.profile.displayName || displayName} url={view.profile.avatarUrl} size={64} type="technician" subtitle={`/t/${view.profile.publicSlug}`} />
                <div style={{ minWidth: 0, flex: 1, marginTop: 4 }}>
                  <div style={{ fontWeight: 800, fontSize: 22, fontFamily: '"Playfair Display",serif', color: '#2C2A29' }}>{view.profile.displayName} <span style={{ fontSize: 14, color: '#8A7A6D', fontFamily: 'system-ui, sans-serif' }}>· {view.profile.overallRating}★ ({view.profile.ratingCount})</span></div>
                  <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4 }}>/t/{view.profile.publicSlug} · {view.profile.completionPercent}{t('pos.complete_membership_here')}{' '}<b style={{ color: '#2C2A29' }}>{view.membershipHereStatus}</b></div>
                  {view.otherActiveSalonCount ? <div style={{ fontSize: 12, color: '#B5821F', marginTop: 2 }}>{t('pos.also_works_at')}{' '}{view.otherActiveSalonCount} {t('pos.other_salon')}{enPlural(view.otherActiveSalonCount === 1 ? '' : 's')}</div> : null}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button style={{ background: '#F8F6F3', border: '1px solid #EFEAE1', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 600, color: '#2C2A29', cursor: 'pointer' }} onClick={() => { setEditOpen((v) => !v); setEName(view.profile.displayName); setETitle(view.profile.title ?? ''); setEBio(view.profile.bio ?? ''); }}>{editOpen ? t('pos.close_edit') : t('pos.edit')}</button>
                  {view.membershipHereStatus === 'active' ? (
                    <button style={{ background: '#FFFFFF', border: '1px solid #EADBB6', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700, color: view.profile.isFeaturedHere ? '#B5821F' : '#2C2A29', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }} disabled={busy === 'feat'}
                      onClick={() => act('feat', () => posTechniciansApi.setTechFeatured(technicianId, !view.profile.isFeaturedHere))}>
                      {view.profile.isFeaturedHere ? t('pos.featured_2') : t('pos.feature_2')}
                    </button>
                  ) : null}
                </div>
              </div>

              {editOpen ? (
                <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#fff', marginBottom: 12, display: 'grid', gap: 8 }} aria-label={t('pos.edit_public_profile')}>
                  <input placeholder={t('pos.display_name')} value={eName} onChange={(e) => setEName(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }} />
                  <input placeholder={t('pos.title_e_g_senior_nail_artist')} value={eTitle} onChange={(e) => setETitle(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }} />
                  <textarea placeholder={t('pos.bio')} rows={3} value={eBio} onChange={(e) => setEBio(e.target.value)} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, resize: 'vertical' }} />
                  <button className="btn" disabled={busy === 'edit'} onClick={() => act('edit', () => posTechniciansApi.updateTechProfile(technicianId, { displayName: eName, title: eTitle, bio: eBio })).then(() => setEditOpen(false))}>{busy === 'edit' ? t('pos.saving_2') : t('pos.save_profile')}</button>
                  <div className="muted" style={{ fontSize: 10.5 }}>{t('pos.salon_assist_edit_of_public_fields_mvf7')}</div>
                </div>
              ) : null}

              <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.portfolio_moderation')}{view.photos.length})</h3>
              {view.photos.length === 0 ? <div style={{ fontSize: 14, color: '#8A7A6D' }}>{t('pos.no_photos_uploaded_yet')}</div> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {view.photos.map((ph: any) => (
                    <div key={ph.photoId} style={{ border: '1px solid #EFEAE1', borderRadius: 12, overflow: 'hidden', background: '#FAFAF9' }}>
                      <img src={ph.thumbnailUrl || ph.imageUrl} alt={ph.caption || t('pos.nail_design')} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                      <div style={{ padding: 12 }}>
                        {/* Moderation is PER SALON (574 tech_portfolio_photo_tenant_hides): "Hide here" never touches the technician's
                            global moderation_status or other salons' pages; a private photo is not published anywhere. */}
                        <span style={{ fontSize: 11, background: ph.hiddenHere ? '#F8F6F3' : ph.isPublic && ph.moderationStatus === 'approved' ? '#EEF7EF' : '#FFF4E5', color: ph.hiddenHere ? '#8A7A6D' : ph.isPublic && ph.moderationStatus === 'approved' ? '#2E7D32' : '#C26A12', padding: '4px 8px', borderRadius: 12, fontWeight: 600 }}>{ph.hiddenHere ? t('pos.hidden_at_this_salon') : ph.isPublic ? (ph.moderationStatus === 'approved' ? 'public' : ph.moderationStatus) : t('pos.private_not_published')}</span>
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                          {ph.hiddenHere ? <button style={{ flex: 1, background: '#2C2A29', color: '#FFFFFF', border: 'none', borderRadius: 20, padding: '6px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }} disabled={busy === ph.photoId} onClick={() => act(ph.photoId, () => posTechniciansApi.moderatePhoto(technicianId, ph.photoId, 'approve'))}>{t('pos.show_here')}</button> : null}
                          {!ph.hiddenHere ? <button style={{ flex: 1, background: '#F8F6F3', color: '#2C2A29', border: '1px solid #EFEAE1', borderRadius: 20, padding: '6px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }} disabled={busy === ph.photoId} onClick={() => act(ph.photoId, () => posTechniciansApi.moderatePhoto(technicianId, ph.photoId, 'hide'))}>{t('pos.hide_here')}</button> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ margin: '32px 0 16px', fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t('pos.reviews')}{ratings.length})</h3>
              {ratings.length === 0 ? <div style={{ fontSize: 14, color: '#8A7A6D' }}>{t('pos.no_reviews_yet')}</div> : ratings.map((r: any) => (
                <div key={r.ratingId} style={{ border: '1px solid #EFEAE1', borderRadius: 12, padding: 16, marginBottom: 12, background: '#FAFAF9', opacity: r.isHiddenByManager ? 0.65 : 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#B5821F' }}>{'★'.repeat(r.rating)} <span style={{ fontWeight: 500, color: '#8A7A6D', marginLeft: 4 }}>— {r.reviewer}{r.serviceName ? ` · ${r.serviceName}` : ''}</span>
                    {r.isHiddenByManager ? <span style={{ marginLeft: 8, fontSize: 11, background: '#FDF0EE', color: '#C0392B', padding: '2px 8px', borderRadius: 12 }}>{t('pos.hidden')}{r.hiddenReason ? `: ${r.hiddenReason}` : ''}</span> : null}
                  </div>
                  {r.reviewText ? <div style={{ fontSize: 14, marginTop: 8, color: '#2C2A29' }}>{r.reviewText}</div> : null}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    {!r.isHiddenByManager ? (
                      <>
                        <input placeholder={t('pos.reason_optional')} value={reason[r.ratingId] ?? ''} onChange={(e) => setReason({ ...reason, [r.ratingId]: e.target.value })}
                          style={{ flex: 1, border: '1px solid #EFEAE1', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }} />
                        <button style={{ background: '#F8F6F3', border: '1px solid #EFEAE1', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 600, color: '#2C2A29', cursor: 'pointer' }} disabled={busy === r.ratingId} onClick={() => act(r.ratingId, () => posTechniciansApi.setRatingHidden(technicianId, r.ratingId, true, reason[r.ratingId]))}>{t('pos.hide_review')}</button>
                      </>
                    ) : (
                      <button style={{ background: '#2C2A29', border: 'none', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer' }} disabled={busy === r.ratingId} onClick={() => act(r.ratingId, () => posTechniciansApi.setRatingHidden(technicianId, r.ratingId, false))}>{t('pos.unhide')}</button>
                    )}
                  </div>
                </div>
              ))}

              {/* What she can DO here. The endpoints behind this have been live the whole time with no screen to
                  call them — see TechnicianAccessPanel. */}
              <TechnicianAccessPanel technicianId={technicianId} displayName={displayName} />

              {view.membershipHereStatus === 'active' ? (
                <button style={{ marginTop: 24, background: '#FFFFFF', color: '#C0392B', border: '1px solid #FADEDC', padding: '10px', borderRadius: 20, fontSize: 13, fontWeight: 600, width: '100%', cursor: 'pointer', transition: 'all 0.2s' }} disabled={busy === 'deact'} onClick={() => act('deact', () => posTechniciansApi.deactivateMembership(technicianId))}>
                  {t('pos.disconnect_profile_from_this_salon')}
                </button>
              ) : null}
            </>
          )}
          {/* Workforce (merge Oct 12): live state, time off, certifications — about the ROSTER technician, so it shows
              whether or not she has a portable profile yet. */}
          <TechnicianWorkforcePanel technicianId={technicianId} />
        </div>
      </div>
    </div>
  );
}
