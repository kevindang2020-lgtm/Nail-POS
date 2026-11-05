// CustomerTechProfileScreen.tsx — P4 public tech profile: hero + Book With This Tech, portfolio gallery with
// lightbox, about, reviews + breakdown, safe external links, Available-at salons. Cross-salon booking keeps the
// platform's honest single-salon-session rule (same note as Find Salons).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerApi, type PublicTechProfile, type TechProfilePhoto, type NSNextAvailable } from '../api/customerApi';
import { useAuth } from '../auth/AuthContext';

import { useEscapeKey } from '@aipowersalon/ui';

export function CustomerTechProfileScreen() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { principal } = useAuth();
  const [p, setP] = useState<PublicTechProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<TechProfilePhoto | null>(null);
  const [pendingLook, setPendingLook] = useState<{ photoId: string; caption: string | null; imageUrl: string } | null>(null);
  const [showBook, setShowBook] = useState(false);
  useEscapeKey(showBook, () => setShowBook(false));
  const galleryScrollRef = useRef<HTMLDivElement | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [msgNotice, setMsgNotice] = useState<string | null>(null);
  const fire = (type: 'link_click' | 'post_tap', ref?: string) => { if (slug) customerApi.techTrackEvent(slug, type, ref).catch(() => {}); };
  const openMessage = async () => {
    if (!slug) return;
    try { const th = await customerApi.techMessageOpen(slug); nav(`/messages/${th.threadId}`); }
    catch (e: any) { setMsgNotice(e?.body?.message || e?.message || 'Messaging is unavailable right now.'); }
  };
  const [favBusy, setFavBusy] = useState(false);

  const loadProfile = useCallback((silent = false) => {
    if (!slug) return;
    customerApi.techProfile(slug, { bypassCache: true })
      .then((d) => {
        setP((prev) => {
          if (!prev) return d;
          if (
            prev.portfolio.length === d.portfolio.length &&
            prev.averageRating === d.averageRating &&
            prev.reviewCount === d.reviewCount &&
            prev.portfolio.every((ph, i) =>
              ph.photoId === d.portfolio[i]?.photoId &&
              ph.isFeatured === d.portfolio[i]?.isFeatured &&
              ph.imageUrl === d.portfolio[i]?.imageUrl &&
              ph.caption === d.portfolio[i]?.caption
            )
          ) {
            return prev;
          }
          return d;
        });
        if (!silent) setError(null);
      })
      .catch((e: any) => {
        if (!silent) setError(e?.message || 'This profile is not available.');
      });
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    loadProfile(false);
    customerApi.techFavorites().then((f) => setIsFav(f.slugs.includes(slug))).catch(() => { /* heart is best-effort */ });

    // Live updates: poll every 2.5s for real-time photo addition, deletion, and count sync
    const interval = setInterval(() => {
      loadProfile(true);
    }, 2500);

    // Immediate sync on tab focus or visibility change
    const onFocus = () => loadProfile(true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadProfile(true);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [slug, loadProfile]);

  const toggleFav = async () => {
    if (!slug) return;
    setFavBusy(true);
    try { if (isFav) { await customerApi.removeTechFavorite(slug); setIsFav(false); } else { await customerApi.addTechFavorite({ publicSlug: slug }); setIsFav(true); } }
    catch { /* keep current state */ } finally { setFavBusy(false); }
  };
  const fmtNext = (n: NSNextAvailable | null) => {
    if (!n) return null;
    const today = new Date(); const pad = (x: number) => String(x).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const [h, m] = n.startTime.split(':'); let hh = Number(h); const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12;
    const t = `${hh}:${m} ${ap}`;
    return n.date === todayStr ? `Today ${t}` : `${new Date(`${n.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${t}`;
  };

  if (error) return <div style={{ padding: 16 }}><div className="cust-card" style={{ padding: 16 }}>{error}</div></div>;
  if (!p) return <div style={{ padding: 16 }} className="cust-sub">Loading…</div>;

  const mySalonHere = (salonId: string) => principal?.branchId != null && salonId === principal.branchId;
  const linkLabels: Record<string, string> = { linkme: 'View LinkMe Profile', linktree: 'View Linktree', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', pinterest: 'Pinterest', website: 'Website' };
  const links = Object.entries(p.profileLinks || {}).filter(([, v]) => !!v) as [string, string][];

  return (
    <div style={{ padding: 16, paddingBottom: 90 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className="customer-back"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Technician Profile</h1>
      </div>

      {/* cover banner */}
      {p.coverUrl ? <div style={{ height: 120, borderRadius: 14, overflow: 'hidden', marginBottom: -38, background: '#EADFCB' }}><img src={p.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div> : null}

      {/* hero */}
      <div className="cust-card" style={{ padding: 16, marginBottom: 12, textAlign: 'center' }}>
        <div style={{ width: 76, height: 76, borderRadius: 99, overflow: 'hidden', border: '3px solid #C9962E', background: '#F2E7D5', margin: '0 auto 8px', display: 'grid', placeItems: 'center', fontSize: 28 }}>
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '💅'}
        </div>
        <div style={{ fontWeight: 800, fontSize: 19 }}>{p.displayName}
          {p.verificationStatus === 'verified' ? <span title="Verified technician" aria-label="Verified technician" style={{ marginLeft: 6, color: '#2F80ED', fontSize: 16 }}>✔</span> : null}
          <button aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={isFav} disabled={favBusy} onClick={toggleFav}
            style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 19, marginLeft: 8, color: isFav ? '#C9962E' : '#D8CDB8' }}>{isFav ? '♥' : '♡'}</button>
        </div>
        {p.badges?.length ? (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
            {p.badges.map((b: string) => <span key={b} style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: 'linear-gradient(135deg,#C9962E,#A96F22)', borderRadius: 99, padding: '3px 10px' }}>{b}</span>)}
          </div>
        ) : null}
        {p.title ? <div className="cust-sub" style={{ fontSize: 13 }}>{p.title}{p.yearsExperience ? ` · ${p.yearsExperience} yrs` : ''}</div> : null}
        <div style={{ color: '#A96F22', fontWeight: 800, fontSize: 15, marginTop: 4 }}>
          {p.averageRating > 0 ? `${p.averageRating.toFixed(1)} ★` : 'New artist'} <span className="cust-sub" style={{ fontWeight: 500, fontSize: 12.5 }}>{p.reviewCount} review{p.reviewCount === 1 ? '' : 's'}</span>
        </div>
        {p.isBookable ? (
          <button className="cust-btn" style={{ width: '100%', marginTop: 12, fontSize: 15 }} onClick={() => { setPendingLook(null); setShowBook(true); }}>Book With This Tech</button>
        ) : <div className="cust-sub" style={{ marginTop: 10, fontSize: 12.5 }}>This artist isn't taking online bookings right now.</div>}
        {p.acceptsMessages ? (
          <>
            <button className="cust-btn ghost" style={{ width: '100%', marginTop: 8, fontSize: 14 }} onClick={openMessage}>Message {p.displayName}</button>
            {msgNotice ? <div className="cust-sub" style={{ fontSize: 12, marginTop: 5, textAlign: 'center' }}>{msgNotice}</div> : null}
          </>
        ) : null}
      </div>

      {/* portfolio — featured first (server order), filterable by style tag */}
      {p.portfolio ? (
        <div className="cust-card" style={{ padding: 14, marginBottom: 12 }}>
          {(() => {
            const facetsOf = (ph: typeof p.portfolio[number]) => [ph.nailShape, ph.nailLength, ph.designStyle, ph.complexity, ph.colorName, ...(ph.tags || [])].filter(Boolean) as string[];
            const facets = Array.from(new Set(p.portfolio.flatMap(facetsOf))).slice(0, 14);
            const filtered = p.portfolio.filter((ph) => !tagFilter || [ph.nailShape, ph.nailLength, ph.designStyle, ph.complexity, ph.colorName, ...(ph.tags || [])].filter(Boolean).includes(tagFilter));

            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>Nail Design Gallery</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 99, background: 'rgba(201,150,46,0.15)', color: '#7A5414' }}>
                      {filtered.length}
                    </span>
                  </div>
                  {filtered.length > 3 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => galleryScrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                        aria-label="Previous photos"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: '1px solid var(--customer-border)',
                          background: '#FFFFFF',
                          color: 'var(--customer-text)',
                          fontSize: 15,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          padding: 0,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryScrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                        aria-label="Next photos"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          border: '1px solid var(--customer-border)',
                          background: '#FFFFFF',
                          color: 'var(--customer-text)',
                          fontSize: 15,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                          padding: 0,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>

                {facets.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }} data-testid="portfolio-tag-filter">
                    <button onClick={() => setTagFilter(null)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, cursor: 'pointer', border: '1px solid var(--customer-border)', background: tagFilter == null ? '#C9962E' : '#fff', color: tagFilter == null ? '#fff' : '#5A4A2F' }}>All</button>
                    {facets.map((t) => (
                      <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, cursor: 'pointer', border: '1px solid var(--customer-border)', background: tagFilter === t ? '#C9962E' : '#fff', color: tagFilter === t ? '#fff' : '#5A4A2F' }}>{t}</button>
                    ))}
                  </div>
                ) : null}

                {filtered.length === 0 ? (
                  <div className="cust-sub" style={{ fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
                    {p.portfolio.length === 0 ? 'No portfolio photos uploaded yet.' : 'No photos match this style tag.'}
                  </div>
                ) : (
                  <div
                    ref={galleryScrollRef}
                  style={{
                    display: 'flex',
                    gap: 8,
                    overflowX: 'auto',
                    paddingBottom: 4,
                    scrollbarWidth: 'none',
                    scrollSnapType: 'x mandatory',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {filtered.map((ph) => {
                    const url = ph.thumbnailUrl || ph.imageUrl;
                    const isVid = url.toLowerCase().match(/\.(mp4|mov|webm)$/i);
                    return (
                      <button
                        key={ph.photoId}
                        onClick={() => setLightbox(ph)}
                        aria-label={ph.caption || 'View design'}
                        style={{
                          flex: '0 0 calc((100% - 16px) / 3)',
                          width: 'calc((100% - 16px) / 3)',
                          minWidth: 'calc((100% - 16px) / 3)',
                          maxWidth: 'calc((100% - 16px) / 3)',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          borderRadius: 12,
                          overflow: 'hidden',
                          background: 'none',
                          scrollSnapAlign: 'start',
                        }}
                      >
                        {isVid ? (
                          <video src={url} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', borderRadius: 12 }} muted playsInline loop autoPlay />
                        ) : (
                          <img src={url} alt={ph.caption || 'Nail design'} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block', borderRadius: 12 }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          );
        })()}
        </div>
      ) : null}

      {/* before & after sets */}
      {p.beforeAfter?.length ? (
        <div className="cust-card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Before &amp; After</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {p.beforeAfter.map((ba) => (
              <div key={ba.setId}>
                <BeforeAfterSlider before={ba.beforeImageUrl} after={ba.afterImageUrl} label={ba.servicePerformed || undefined} />
                {(ba.servicePerformed || ba.designNotes) ? (
                  <div style={{ marginTop: 5 }}>
                    {ba.servicePerformed ? <span style={{ fontSize: 12.5, fontWeight: 700 }}>{ba.servicePerformed}</span> : null}
                    {ba.durationMinutes ? <span className="cust-sub" style={{ fontSize: 11.5 }}>{ba.servicePerformed ? ' · ' : ''}{ba.durationMinutes} min</span> : null}
                    {ba.designNotes ? <div className="cust-sub" style={{ fontSize: 12 }}>{ba.designNotes}</div> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* about */}
      {(p.bio || p.specialties.length || p.languages.length) ? (
        <div className="cust-card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>About</div>
          {p.bio ? <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{p.bio}</div> : null}
          {p.specialties.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {p.specialties.map((sp: string) => <span key={sp} style={{ fontSize: 11.5, fontWeight: 700, color: '#A96F22', background: '#F7EFE3', border: '1px solid #E6D3B3', borderRadius: 99, padding: '4px 10px' }}>{sp}</span>)}
            </div>
          ) : null}
          {p.languages.length ? <div className="cust-sub" style={{ fontSize: 12, marginTop: 8 }}>Speaks: {p.languages.join(', ')}</div> : null}
        </div>
      ) : null}

      {/* showcase posts attributed to this technician — opens the full post (likes/comments) */}
      {p.posts?.length ? (
        <div className="cust-card" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>Featured Work</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {p.posts.map((post) => (
              <button key={post.postId} onClick={() => { fire('post_tap', post.postId); nav(`/nail-showcase/${post.postId}`); }}
                style={{ position: 'relative', padding: 0, border: 'none', borderRadius: 10, overflow: 'hidden', aspectRatio: '1 / 1', cursor: 'pointer', background: 'var(--customer-border)' }}
                aria-label={post.caption || 'View post'}>
                {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt={post.caption || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
                <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 5px', fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'linear-gradient(transparent, rgba(0,0,0,0.55))', textAlign: 'right' }}>♥ {post.likeCount} · 💬 {post.commentCount}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* reviews */}
      <div className="cust-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Verified Reviews</div>
        {p.reviewCount === 0 ? <div className="cust-sub" style={{ fontSize: 12.5 }}>No reviews yet.</div> : (
          <>
            {p.ratingBreakdown.map((b) => (
              <div key={b.star} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, marginBottom: 3 }}>
                <span style={{ width: 36 }} className="cust-sub">{b.star} star</span>
                <div style={{ flex: 1, height: 6, borderRadius: 99, background: '#F1EADC', overflow: 'hidden' }}><div style={{ width: `${b.pct}%`, height: '100%', background: '#C9962E' }} /></div>
                <span className="cust-sub" style={{ width: 32, textAlign: 'right' }}>{b.pct}%</span>
              </div>
            ))}
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              {p.reviews.map((r, i) => (
                <div key={i} style={{ borderTop: '1px solid var(--customer-border)', paddingTop: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#A96F22' }}>{'★'.repeat(r.rating)} <span className="cust-sub" style={{ fontWeight: 600 }}>{r.reviewer}</span></div>
                  {r.reviewText ? <div style={{ fontSize: 13, marginTop: 2 }}>{r.reviewText}</div> : null}
                  {r.response ? (
                    <div style={{ marginTop: 6, marginLeft: 10, paddingLeft: 8, borderLeft: '2px solid var(--customer-border)' }}>
                      <div className="cust-sub" style={{ fontSize: 11, fontWeight: 700 }}>Response from {p.displayName}</div>
                      <div style={{ fontSize: 12.5, marginTop: 1 }}>{r.response}</div>
                    </div>
                  ) : null}
                  <div className="cust-sub" style={{ fontSize: 11, marginTop: 3 }}>
                    {r.serviceName ? `Service: ${r.serviceName} · ` : ''}{new Date(r.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    {r.tags?.length ? ` · ${r.tags.join(' · ')}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* external links — safe open only */}
      {links.length ? (
        <div className="cust-card" style={{ padding: 14, marginBottom: 12, display: 'grid', gap: 8 }}>
          {links.map(([k, url]) => (
            <a key={k} className="cust-btn ghost" style={{ textAlign: 'center', textDecoration: 'none', fontSize: 13 }} href={url} target="_blank" rel="noopener noreferrer" onClick={() => fire('link_click', k)}>{linkLabels[k] || k}</a>
          ))}
        </div>
      ) : null}

      {/* available at */}
      {p.availableAt.length ? (
        <div className="cust-card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>Available at</div>
          {p.availableAt.map((s) => (
            <div key={s.salonId} style={{ padding: '8px 0', borderTop: '1px solid var(--customer-border)' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.salonName}</div>
              <div className="cust-sub" style={{ fontSize: 12 }}>{s.address}</div>
              {s.nextAvailableAt ? <div style={{ fontSize: 12, color: '#2E7D32', fontWeight: 700, marginTop: 2 }}>Next available: {fmtNext(s.nextAvailableAt)}</div> : null}
              {s.services?.length ? (
                <div style={{ marginTop: 6 }}>
                  <div className="cust-sub" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 2 }}>Services I do here</div>
                  {s.services.map((sv) => (
                    <div key={sv.serviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                      <span>{sv.name}{sv.isPrimary ? ' ⭐' : ''}</span>
                      <span className="cust-sub">{sv.durationMinutes} min · ${(sv.priceCents / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* book sheet — per-salon, honest cross-salon rule */}
      {showBook ? (
        <div role="dialog" aria-modal="true" aria-label="Book with this tech" onClick={() => setShowBook(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(23,19,31,0.45)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} className="cust-card" style={{ width: '100%', borderRadius: '18px 18px 0 0', padding: 18, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Book {p.displayName}</div>
            {pendingLook ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#F4E9D8', borderRadius: 12, padding: 8, marginBottom: 10 }}>
                <img src={pendingLook.imageUrl} alt="Selected look" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />
                <div style={{ fontSize: 12.5 }}><span style={{ fontWeight: 800 }}>Booking this look</span>{pendingLook.caption ? <div className="cust-sub" style={{ fontSize: 11.5 }}>{pendingLook.caption}</div> : null}</div>
              </div>
            ) : null}
            <div className="cust-sub" style={{ fontSize: 12.5, marginBottom: 10 }}>Choose the location — your booking goes straight to that salon.</div>
            {p.availableAt.map((s) => (
              <div key={s.salonId} style={{ borderTop: '1px solid var(--customer-border)', padding: '10px 0' }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.salonName}</div>
                <div className="cust-sub" style={{ fontSize: 12, marginBottom: 8 }}>{s.address}</div>
                {s.nextAvailableAt ? <div style={{ fontSize: 12, color: '#2E7D32', fontWeight: 700, marginBottom: 6 }}>Next available: {fmtNext(s.nextAvailableAt)}</div> : null}
                {mySalonHere(s.salonId) ? (
                  <button className="cust-btn" style={{ width: '100%' }} onClick={() => { setShowBook(false); const url = `/book?techId=${s.technicianId ?? ''}`; if (pendingLook) nav(url, { state: { look: { ...pendingLook, techName: p.displayName } } }); else nav(url); }}>Book Appointment</button>
                ) : (
                  <div className="cust-sub" style={{ fontSize: 12, lineHeight: 1.45 }}>This partner salon takes in-app bookings. You're signed in with a different salon — call to book, or sign in with an account for this salon.</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* lightbox */}
      {lightbox ? (
        <div role="dialog" aria-modal="true" aria-label="Nail design" onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(23,19,31,0.85)', display: 'grid', placeItems: 'center', padding: 18 }}>
          <div style={{ maxWidth: 480, width: '100%' }}>
            {lightbox.imageUrl.toLowerCase().match(/\.(mp4|mov|webm)$/i)
              ? <video src={lightbox.imageUrl} style={{ width: '100%', borderRadius: 14 }} controls playsInline autoPlay />
              : <img src={lightbox.imageUrl} alt={lightbox.caption || 'Nail design'} style={{ width: '100%', borderRadius: 14 }} />}
            {lightbox.caption ? <div style={{ color: '#fff', fontSize: 13, marginTop: 8, textAlign: 'center' }}>{lightbox.caption}</div> : null}
            {(() => { const chips = [lightbox.nailShape, lightbox.nailLength, lightbox.designStyle, lightbox.complexity, lightbox.colorName, lightbox.brand].filter(Boolean) as string[]; return chips.length ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
                {chips.map((c, idx) => <span key={idx} style={{ fontSize: 11, fontWeight: 700, color: '#3A2F1C', background: '#F4E9D8', borderRadius: 99, padding: '4px 10px' }}>{c}</span>)}
              </div>
            ) : null; })()}
            {p.isBookable ? (
              <button className="cust-btn" style={{ width: '100%', marginTop: 12, fontSize: 14 }}
                onClick={() => { setPendingLook({ photoId: lightbox.photoId, caption: lightbox.caption, imageUrl: lightbox.imageUrl }); setLightbox(null); setShowBook(true); }}>
                Book This Look
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BeforeAfterSlider({ before, after, label }: { before: string; after: string; label?: string }) {
  const [pct, setPct] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const alt = label ? ` — ${label}` : '';
  const setFromClientX = (clientX: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(r.right, Math.max(r.left, clientX));
    setPct(Math.round(((x - r.left) / r.width) * 100));
  };
  return (
    <div
      ref={ref}
      role="slider" aria-label={`Before and after comparison${alt}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} tabIndex={0}
      onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setFromClientX(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) setFromClientX(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPct((v) => Math.max(0, v - 4)); else if (e.key === 'ArrowRight') setPct((v) => Math.min(100, v + 4)); }}
      style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', userSelect: 'none', touchAction: 'none', cursor: 'ew-resize', background: '#EEE' }}
    >
      <img src={after} alt={`After${alt}`} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <img src={before} alt={`Before${alt}`} draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', clipPath: `inset(0 ${100 - pct}% 0 0)` }} />
      <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: '#fff', background: 'rgba(20,16,10,0.55)', borderRadius: 999, padding: '2px 8px', pointerEvents: 'none' }}>BEFORE</span>
      <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: '#2C2118', background: 'rgba(255,255,255,0.85)', borderRadius: 999, padding: '2px 8px', pointerEvents: 'none' }}>AFTER</span>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${pct}%`, width: 2, background: 'rgba(255,255,255,0.9)', transform: 'translateX(-1px)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 30, height: 30, marginTop: -15, marginLeft: -15, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A96F22" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" /></svg>
      </div>
    </div>
  );
}
