// POSReviewsScreen.tsx — Marketing → Reviews. Wired to /pos/reviews (pos.marketing.view read,
// pos.marketing.manage write). Reputation overview: average rating, star distribution, and a
// review feed with manager hide/unhide.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posReviewsApi } from '../api/posReviewsApi';
import { reportError } from './reportsCommon';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';

type Review = { id: string; rating: number; comment: string | null; technicianId: string | null; technicianName: string | null; tags: string[]; isPublic: boolean; isHidden: boolean; hiddenReason: string | null; customerId: string | null; createdAt: string };
type Bucket = { star: number; count: number };
type Summary = { totalReviews: number; averageRating: number; ratingDistribution: Bucket[]; publicCount: number; hiddenCount: number; withCommentCount: number; fiveStarPercent: number };
type State = { kpis: Summary; reviews: Review[] };

const stars = (n: number) => { const full = Math.round(n); return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full); };
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };

export function POSReviewsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posReviewsApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'reviews')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Inline hide-reason editor (Jul 27, 2026) — replaces window.prompt; the reason stays required.
  const [hiding, setHiding] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState('');
  const hide = async (id: string) => {
    const reason = hideReason.trim();
    if (!reason) { setNote(t('pos.a_reason_is_required_to_hide_1d07')); return; }
    setBusy(id); setNote(null);
    try { await posReviewsApi.setVisibility(id, true, reason); setHiding(null); setHideReason(''); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_hide_the_review')); }
    finally { setBusy(null); }
  };
  const unhide = async (id: string) => {
    setBusy(id); setNote(null);
    try { await posReviewsApi.setVisibility(id, false, null); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_restore_the_review')); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_reviews')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_review_data')}</div></div>;

  const k = s.kpis;
  const reviews = s.reviews || [];
  const dist = k.ratingDistribution || [];
  const maxBucket = Math.max(1, ...dist.map((d) => d.count));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.reviews_2')}</h1><div className="sub">{t('pos.reputation_overview_and_manager_moderation')}</div></div>

   <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 mb-4">
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.average_rating_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.averageRating?.toFixed(1) ?? '0.0'}</div><div className="d" style={{ color: 'var(--gold)', fontSize: 13, marginTop: 4 }}>{stars(k.averageRating || 0)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.total_reviews')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.totalReviews ?? 0}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.public_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.publicCount ?? 0}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.hidden_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.hiddenCount ?? 0}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.5_star_share_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{(k.fiveStarPercent ?? 0)}%</div></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="panel">
          <div className="p-h">{t('pos.rating_distribution')}</div>
          {k.totalReviews === 0 ? <div className="state">{t('pos.no_reviews_yet')}</div> : (
            <div>
              {dist.map((d) => (
                <div key={d.star} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
                  <span style={{ width: 34, color: 'var(--muted)', fontSize: 13 }}>{d.star}★</span>
                  <div style={{ flex: 1, background: 'var(--line)', borderRadius: 6, height: 14, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((d.count / maxBucket) * 100)}%`, height: '100%', background: '#C99E53' }} />
                  </div>
                  <span style={{ width: 30, textAlign: 'right', fontSize: 13 }}>{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.at_a_glance')}</div>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.9 }}>
            <div>{k.withCommentCount ?? 0} {t('pos.of')}{' '}{k.totalReviews ?? 0} {t('pos.reviews_include_a_written_comment')}</div>
            <div>{k.hiddenCount ?? 0} {t('pos.review_3')}{enPlural(k.hiddenCount === 1 ? '' : 's')} {t('pos.currently_hidden_by_a_manager')}</div>
            <div>{(k.fiveStarPercent ?? 0)}{t('pos.of_reviews_are_rated_4_5_1jre')}</div>
          </div>
          {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}
        </section>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.review_feed')}</div>
        {reviews.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_reviews_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <table className="tbl">
                <thead><tr><th style={{ width: 90 }}>{t('pos.rating')}</th><th>{t('pos.comment')}</th><th>{t('pos.technician')}</th><th>{t('pos.date')}</th><th></th></tr></thead>
                <tbody>{reviews.map((r) => (
                  <tr key={r.id} style={r.isHidden ? { opacity: 0.55 } : undefined}>
                    <td style={{ color: 'var(--gold)', whiteSpace: 'nowrap' }} title={String(r.rating)}>{stars(r.rating)}</td>
                    <td>{r.comment || <span style={{ color: 'var(--muted)' }}>—</span>}{r.isHidden ? <span style={{ color: '#B4453C', fontSize: 12, marginLeft: 6 }}>{t('pos.hidden_3')}{' '}{r.hiddenReason})</span> : null}</td>
                    <td>{r.technicianName || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {r.isHidden
                        ? <button className="btn ghost" disabled={busy === r.id} onClick={() => unhide(r.id)}>{t('pos.restore')}</button>
                        : hiding === r.id ? (
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input aria-label={t('pos.reason_for_hiding')} placeholder={t('pos.reason_for_hiding')} value={hideReason} onChange={(ev) => setHideReason(ev.target.value)}
                                autoFocus style={{ minHeight: 36, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', fontSize: 12, width: 190 }} />
                              <button className="btn" disabled={busy === r.id} onClick={() => hide(r.id)} style={{ background: '#B4453C', color: '#fff', borderColor: '#B4453C' }}>{t('pos.hide')}</button>
                              <button className="btn ghost" onClick={() => { setHiding(null); setHideReason(''); }}>{t('pos.cancel')}</button>
                            </span>
                          ) : <button className="btn ghost" disabled={busy === r.id} onClick={() => { setHiding(r.id); setHideReason(''); setNote(null); }}>{t('pos.hide')}</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
