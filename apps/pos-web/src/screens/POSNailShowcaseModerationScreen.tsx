import { useCallback, useEffect, useState } from 'react';
import { posNailShowcaseApi, type PosNSPost, type PosNSReport, type PosNSStatus } from '../api/posNailShowcaseApi';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { growthCode } from './growthLabels';

// POS NailShowcase moderation — manager view of this salon's customer nail posts + the open report queue. Reads the real
// /pos/nail-showcase/posts (status / reportedOnly filters) and /pos/nail-showcase/reports; Hide / Approve / Resolve call
// the backend, which scopes every action to the manager's own tenant. No fabricated content — honest empty states.
const fmt = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };
const STATUSES: { key: string; label: string }[] = [
  { key: '', get label() { return t('pos.all'); } }, { key: 'published', get label() { return t('pos.published_2'); } }, { key: 'pending_review', get label() { return t('pos.pending'); } }, { key: 'hidden', get label() { return t('pos.hidden_2'); } }, { key: 'reported', get label() { return t('pos.reported_2'); } },
];
const tone = (s: PosNSStatus) => (s === 'published' ? 'ok' : s === 'pending_review' || s === 'reported' ? 'warn' : '');

export function POSNailShowcaseModerationScreen() {
  const [posts, setPosts] = useState<PosNSPost[] | null>(null);
  const [reports, setReports] = useState<PosNSReport[] | null>(null);
  const [status, setStatus] = useState('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<PosNSPost | null>(null);
  const loadPosts = useCallback(() => {
    posNailShowcaseApi.posts({ status: status || undefined, reportedOnly: reportedOnly || undefined })
      .then((d) => setPosts(d)).catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_posts')));
  }, [status, reportedOnly]);
  const loadReports = useCallback(() => { posNailShowcaseApi.reports().then(setReports).catch(() => setReports([])); }, []);
  useEffect(() => { loadPosts(); }, [loadPosts]);
  useEffect(() => { loadReports(); }, [loadReports]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); loadPosts(); loadReports(); }
    catch (e) { setError((e as { message?: string })?.message || t('pos.action_failed')); }
    finally { setBusy(null); }
  };

  const pending = posts?.filter((p) => p.status === 'pending_review').length ?? 0;
  const kpis = [
    { l: t('pos.posts_shown'), v: posts?.length ?? '—' },
    { l: t('pos.pending_review'), v: pending, warn: pending > 0 },
    { l: t('pos.open_reports'), v: reports?.length ?? '—', warn: (reports?.length ?? 0) > 0 },
  ];
  const isVideoMedia = (media: {
    type?: string;
    mimeType?: string;
    videoUrl?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
  }) => {
    if (media.type === 'video' || media.mimeType?.startsWith('video/')) {
      return true;
    }

    const url = media.videoUrl || media.imageUrl || media.thumbnailUrl || '';

    return /\.(mp4|webm|mov)(\?.*)?$/i.test(url);
  };
  return (
    <>

      <div className="work">
        <div className="vh">
          <h1>{t('pos.nailshowcase_moderation')}</h1>
          <div className="sub">{t('pos.customer_nail_posts_reports_for_this_myv9')}</div>
        </div>

        {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}

        <div className="kpis">
          {kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" style={c.warn ? { color: 'var(--danger)' } : undefined}>{c.v}</div></div>))}
        </div>

        <section className="panel" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('pos.open_reports')}</h2>
          {!reports ? <div className="muted">{t('pos.loading')}</div>
            : reports.length === 0 ? <div className="muted">{t('pos.no_open_reports')}</div>
              : (
                <div className="list" style={{ maxHeight: 240 }}>
                  {reports.map((r) => (
                    <div className="row" key={r.id} style={{ gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div className="t" style={{ fontSize: 13 }}>{r.postId ? t('pos.post') : r.commentId ? t('growth.showcase.comment') : t('growth.showcase.content')} {t('pos.reported')}{' '}<span style={{ textTransform: 'capitalize' }}>{growthCode(r.reason)}</span></div>
                        <div className="muted" style={{ fontSize: 12 }}>{r.details || '—'} · {fmt(r.createdAt)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {r.postId ? <button className="btn" disabled={busy === 'hide' + r.postId} onClick={() => act('hide' + r.postId, () => posNailShowcaseApi.hidePost(r.postId!))}>{t('pos.hide_post')}</button> : null}
                        {r.commentId ? <button className="btn" disabled={busy === 'hc' + r.commentId} onClick={() => act('hc' + r.commentId, () => posNailShowcaseApi.hideComment(r.commentId!))}>{t('pos.hide_comment')}</button> : null}
                        <button className="btn" disabled={busy === 'at' + r.id} onClick={() => act('at' + r.id, () => posNailShowcaseApi.resolveReport(r.id, 'action_taken'))}>{t('pos.action_taken')}</button>
                        <button className="btn" disabled={busy === 'dm' + r.id} onClick={() => act('dm' + r.id, () => posNailShowcaseApi.resolveReport(r.id, 'dismissed'))}>{t('pos.dismiss')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {STATUSES.map((s) => (
              <button key={s.key} className="btn" onClick={() => setStatus(s.key)} style={status === s.key ? { background: 'var(--accent, #A96F22)', color: '#fff', borderColor: 'transparent' } : undefined}>{s.label}</button>
            ))}
            <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 'auto' }}>
              <input type="checkbox" checked={reportedOnly} onChange={(e) => setReportedOnly(e.target.checked)} /> {t('pos.reported_only')}
            </label>
          </div>

          {!posts ? <div className="muted">{t('pos.loading')}</div>
            : posts.length === 0 ? <div className="muted">{t('pos.no_posts_match_this_filter')}</div>
              : (
                <div className="list" style={{ maxHeight: 'calc(100vh - 360px)' }}>
                  {posts.map((p) => (
                    <div className="row" key={p.id} style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ width: 52, height: 52, borderRadius: 8, overflow: 'hidden', background: 'var(--soft, #F7EFE3)', flexShrink: 0, position: 'relative' }}>
                        {p.photos[0] ? (
                          isVideoMedia(p.photos[0]) ? (
                            <video src={p.photos[0].videoUrl || p.photos[0].imageUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <img src={p.photos[0].thumbnailUrl || p.photos[0].imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          )
                        ) : (
                          <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 22 }}>💅</div>
                        )}

                        {p.photos[0] && isVideoMedia(p.photos[0]) && (
                          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                            <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.65)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10 }}>▶</div>
                          </div>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div className="t" style={{ fontSize: 13 }}>{p.caption || <span className="muted">{t('pos.no_caption')}</span>} {p.isVerifiedService ? <span className="muted" style={{ fontSize: 11 }}>{t('pos.verified_2')}</span> : null}</div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {p.displayName}{p.technicianName ? t('pos.tech_technicianname', { technicianName: String(p.technicianName) }) : ''}{p.serviceName ? ` · ${p.serviceName}` : ''}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>❤️ {p.likeCount} · 👎 {p.dislikeCount} · 💬 {p.commentCount}{p.reportCount > 0 ? t('pos.reportcount_reports', { reportCount: String(p.reportCount) }) : ''} · {fmt(p.createdAt)}</div>
                      </div>
                      <div className='flex flex-wrap gap-2 items-center'>
                        <p className={`pill ${tone(p.status)}`} style={{ fontSize: 11, textTransform: 'capitalize' }}>{growthCode(p.status)}</p>
                        <div className='flex gap-2 items-baseline'>
                          {p.status !== 'published' ? <button className="btn" disabled={busy === 'ap' + p.id} onClick={() => act('ap' + p.id, () => posNailShowcaseApi.approvePost(p.id))}>{t('pos.approve')}</button> : null}
                          {p.status !== 'hidden' && p.status !== 'removed' ? <button className="btn !h-6 !rounded-lg flex items-center" disabled={busy === 'hp' + p.id} onClick={() => act('hp' + p.id, () => posNailShowcaseApi.hidePost(p.id))}>{t('pos.hide')}</button> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedPost(p)}
                          className="capitalize btn ghost !h-6 !rounded-lg flex items-center hover:!bg-[#C69A4E] hover:!text-white"
                        >
                          {t('pos.view_details')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
        </section>
      </div>
      {selectedPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5" onClick={() => setSelectedPost(null)}>
          <div className="relative flex h-[92vh] max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--line,#e6e1ef)] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>

            <div className="flex shrink-0 items-center justify-between border-b border-[var(--line,#e6e1ef)] bg-white px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-[var(--text,#29242f)] sm:text-lg">{t('pos.nail_showcase_details')}</h2>
                  <span className={`pill ${tone(selectedPost.status)} text-[10px] capitalize`}>{growthCode(selectedPost.status)}</span>
                </div>

                <p className="mt-1 text-xs text-[var(--muted,#777)]">{t('pos.showcase_post')}{' '}{fmt(selectedPost.createdAt)}</p>
              </div>

              <button type="button" onClick={() => setSelectedPost(null)} aria-label={t('pos.close')} className="ml-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line,#e6e1ef)] bg-white text-xl leading-none text-[var(--muted,#777)] transition hover:border-[var(--accent,#A96F22)] hover:bg-[var(--soft,#f7efe3)] hover:text-[var(--text,#29242f)]">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <div className="grid h-full min-h-0 lg:grid-cols-[1.05fr_0.95fr]">

                <div className="min-h-0 overflow-y-auto border-b border-[var(--line,#e6e1ef)] bg-[#f8f8f8] p-4 sm:p-5 lg:border-b-0 lg:border-r">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-[var(--text,#29242f)]">{t('pos.showcase_media')}</h3>
                      <p className="mt-0.5 text-[11px] text-[var(--muted,#777)]">{selectedPost.photos?.length || 0} {t('pos.media_item')}{enPlural(selectedPost.photos?.length === 1 ? '' : 's')}</p>
                    </div>
                  </div>

                  {selectedPost.photos?.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {selectedPost.photos.map((media, index) => {
                        const video = isVideoMedia(media);

                        return (
                          <div key={media.id || index} className="group relative aspect-square overflow-hidden rounded-xl border border-[var(--line,#e6e1ef)] bg-black shadow-sm">
                            {video ? (
                              <video src={media.videoUrl || media.imageUrl} controls muted playsInline preload="metadata" className="h-full w-full object-cover" />
                            ) : (
                              <img src={media.thumbnailUrl || media.imageUrl} alt={t('pos.nail_showcase_v0', { v0: String(index + 1) })} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
                            )}

                            <div className="pointer-events-none absolute left-2 top-2">
                              <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">{video ? t('pos.video') : t('pos.photo')}</span>
                            </div>

                            <div className="pointer-events-none absolute bottom-2 right-2">
                              <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">{index + 1}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-[var(--line,#e6e1ef)] bg-white">
                      <div className="text-center">
                        <div className="text-4xl">💅</div>
                        <p className="mt-2 text-sm font-medium text-[var(--text,#29242f)]">{t('pos.no_media_available')}</p>
                        <p className="mt-1 text-xs text-[var(--muted,#777)]">{t('pos.this_post_does_not_contain_any_iwp5')}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="min-h-0 min-w-0 overflow-y-auto bg-white p-5 sm:p-6">

                  <div className="mb-5">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted,#777)]">{t('pos.customer')}</div>
                    <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white px-4 py-3">
                      <div className="text-sm font-bold text-[var(--text,#29242f)]">{selectedPost.displayName || t('pos.anonymous_customer')}</div>
                      <div className="mt-1 text-[11px] text-[var(--muted,#777)]">{t('pos.customer_showcase_submission')}</div>
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted,#777)]">{t('pos.appointment_information')}</div>
                    <div className="grid gap-3 sm:grid-cols-2">

                      <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C69A4E] text-sm">👤</div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.technician')}</div>
                            <div className="mt-1 truncate text-sm font-semibold text-[var(--text,#29242f)]">{selectedPost.technicianName || t('pos.not_specified')}</div>
                            {selectedPost.technicianName && (
                              <button type="button" className="mt-1 text-[11px] font-semibold text-[var(--accent,#A96F22)] opacity-60" disabled title={t('pos.the_post_does_not_carry_a_1ype')}>{t('pos.view_profile')}</button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C69A4E] text-sm">📍</div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.branch')}</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--text,#29242f)]">{selectedPost.branchName || t('pos.not_specified')}</div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4 sm:col-span-2">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C69A4E] text-sm">✨</div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.service_performed')}</div>
                            <div className="mt-1 text-sm font-semibold text-[var(--text,#29242f)]">{selectedPost.serviceName || t('pos.not_specified')}</div>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted,#777)]">{t('pos.style_category')}</div>
                    <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                      {selectedPost.tags?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {selectedPost.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-[var(--line,#e6e1ef)] bg-[#C69A4E] px-3 py-1.5 text-[11px] font-semibold text-[var(--text,#29242f)]">#{tag}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--muted,#777)]">{t('pos.no_style_or_category_tags_added')}</span>
                      )}
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted,#777)]">{t('pos.caption')}</div>
                    <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                      <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--text,#29242f)]">{selectedPost.caption || t('pos.no_caption_provided')}</p>
                    </div>
                  </div>

                  <div className="mb-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.date')}</div>
                      <div className="mt-2 text-sm font-semibold text-[var(--text,#29242f)]">{fmt(selectedPost.createdAt)}</div>
                    </div>

                    <div className="rounded-xl border border-[var(--line,#e6e1ef)] bg-white p-4">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.products_colors')}</div>
                      <div className="mt-2 text-sm font-semibold text-[var(--text,#29242f)]">{selectedPost.products?.length ? selectedPost.products.join(', ') : t('pos.not_specified')}</div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#dedede] bg-[#f5f5f5] p-4">
                    <div className="mb-4">
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#555]">{t('pos.engagement')}</div>
                      <div className="mt-0.5 text-[11px] text-[#888]">{t('pos.post_interaction_summary')}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">

                      <div className="rounded-lg border border-[#e2e2e2] bg-white p-3">
                        <div className="text-base font-bold text-[var(--text,#29242f)]">{selectedPost.likeCount ?? 0}</div>
                        <div className="mt-0.5 text-[11px] text-[#777]">{t('pos.likes')}</div>
                      </div>

                      <div className="rounded-lg border border-[#e2e2e2] bg-white p-3">
                        <div className="text-base font-bold text-[var(--text,#29242f)]">{selectedPost.saveCount ?? 0}</div>
                        <div className="mt-0.5 text-[11px] text-[#777]">{t('pos.saves')}</div>
                      </div>

                      <div className="rounded-lg border border-[#e2e2e2] bg-white p-3">
                        <div className="text-base font-bold text-[var(--text,#29242f)]">{selectedPost.shareCount ?? 0}</div>
                        <div className="mt-0.5 text-[11px] text-[#777]">{t('pos.shares')}</div>
                      </div>

                      <div className="rounded-lg border border-[#e2e2e2] bg-white p-3">
                        <div className="text-base font-bold text-[var(--text,#29242f)]">{selectedPost.commentCount ?? 0}</div>
                        <div className="mt-0.5 text-[11px] text-[#777]">{t('pos.comments')}</div>
                      </div>

                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between rounded-xl border border-[var(--line,#e6e1ef)] bg-white px-4 py-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#777)]">{t('pos.moderation_status')}</div>
                      <div className="mt-1 text-xs text-[var(--muted,#777)]">{t('pos.current_visibility_state_of_this_showcase')}</div>
                    </div>

                    <span className={`pill ${tone(selectedPost.status)} text-xs capitalize`}>{growthCode(selectedPost.status)}</span>
                  </div>

                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--line,#e6e1ef)] bg-white px-5 py-3 sm:px-6">
              <button type="button" onClick={() => setSelectedPost(null)} className="btn !h-8 !rounded-lg px-4 text-xs">{t('pos.close')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
