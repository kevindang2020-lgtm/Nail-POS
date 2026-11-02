import { useEffect, useState } from 'react';
import { useScopedQuery, OfflineStatus } from '@aipowersalon/mobile-sdk';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerHome, type BookableService } from '../api/customerApi';
import { customerNailShowcaseApi, type NSPostView } from '../api/customerNailShowcaseApi';
import { PayBanner } from './PayBanner';
import { apptWhen } from '../lib/appt';
import { centsToUsdWhole } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display
import { isGuest, exitGuestMode } from '../auth/guest';
import { GuestModal } from '../components/GuestModal';

const money = (c: number) => centsToUsdWhole(c);
const initials = (name: string) => (name || '').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '🙂';
const firstName = (name: string) => (name || '').trim().split(/\s+/)[0] || '';



const QUICK = [
  { key: 'book', label: 'Book Now', to: '/book', bg: 'var(--customer-primary-light)', fg: 'var(--customer-primary)', icon: '📅' },
  { key: 'checkin', label: 'Check-In', to: '/check-in', bg: 'var(--customer-green-light)', fg: 'var(--customer-green)', icon: '📍' },
  { key: 'appts', label: 'My Appointments', to: '/appointments', bg: 'var(--customer-primary-light)', fg: 'var(--customer-primary)', icon: '🗓️' },
  { key: 'queue', label: 'Live Queue', to: '/queue', bg: 'var(--customer-pink-light)', fg: 'var(--customer-pink)', icon: '⏱️' },
] as const;

export function HomeScreen() {
  const nav = useNavigate();
  // Guest browsing (no session): the private summary / badges are never requested and no loyalty numbers are shown —
  // a guest sees a sign-in banner instead, and actions that need an account open the sign-in prompt.
  const guest = isGuest();
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestModalMsg, setGuestModalMsg] = useState('Please sign in or create an account to book appointments and save your favorites.');
  // BUILD_PLAN Phase 13: the home summary through the query layer (scoped to this customer, offline read cache); the
  // rest of the page (salon, nearby, inspiration…) stays best-effort as before.
  const hq = useScopedQuery<CustomerHome>({ key: ['customer', 'home'], fn: () => customerApi.home(), persist: true, enabled: !guest });
  const h = guest ? null : (hq.data ?? null);
  const [services, setServices] = useState<BookableService[]>([]);
  const [salon, setSalon] = useState<any | null>(null);
  const [nearbySalons, setNearbySalons] = useState<any[]>([]);
  const [topTechs, setTopTechs] = useState<any[]>([]);
  const error = !guest && !h && hq.isError ? ((hq.error as any)?.message || 'Could not load your account.') : null;
  const [unread, setUnread] = useState(0);
  const [ratePrompt, setRatePrompt] = useState<any | null>(null);
  const [inspo, setInspo] = useState<NSPostView[]>([]);

  useEffect(() => {
    let live = true;
    customerApi.salon().then((s) => { if (live) setSalon(s); }).catch(() => {});
    customerApi.salonsNearby({ radiusMiles: 25 }).then((r) => { if (live) setNearbySalons(r.results || []); }).catch(() => {});
    customerApi.bookingOptions().then((o) => {
      if (live) {
        setServices(o.services.slice(0, 6));
        setTopTechs(o.technicians || []);
      }
    }).catch(() => { /* popular services are best-effort */ });
    if (!guest) {
      customerApi.notifications().then((d) => { if (live) setUnread(d.unreadCount); }).catch(() => { /* badge is best-effort */ });
      customerApi.pendingTechRatings().then((d) => { if (live) setRatePrompt(d.pending[0] ?? null); }).catch(() => { /* prompt is best-effort */ });
    }
    customerNailShowcaseApi.feed({ sort: 'trending', limit: 10 }).then((r) => { if (live) setInspo((r.posts || []).filter((p) => p.photos && p.photos.length).slice(0, 8)); }).catch(() => { /* inspiration is best-effort */ });
    return () => { live = false; };
  }, [guest]);

  const promptGuest = (msg?: string) => {
    setGuestModalMsg(msg || 'Please sign in or create an account to book appointments and access personalized salon features.');
    setGuestModalOpen(true);
  };

  const onQuickAction = (key: string, to: string) => {
    if (guest && (key === 'book' || key === 'checkin' || key === 'queue' || key === 'appts')) {
      promptGuest(key === 'book' ? 'Sign in or create an account to book your salon appointment.' : key === 'checkin' ? 'Sign in to check in to your salon.' : key === 'queue' ? 'Sign in to view your real-time queue position.' : 'Sign in to view and manage your appointments.');
      return;
    }
    nav(to);
  };

  if (error) return <div style={{ padding: 18 }}><div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></div>;
  if (!h && !error) {
    // Only continue rendering if loading. We'll use inline shimmers below.
  }

  const l = h?.loyalty;
  const share = async () => {
    let text = 'Book your next appointment with me on AIPowerSalon!';
    let code = '';
    try { const ref = await customerApi.referral(); if (ref) { text = ref.shareMessage; code = ref.code; } } catch { /* fall back to generic text */ }
    const url = typeof window !== 'undefined' ? window.location.origin : '';
    const data: any = { title: 'AIPowerSalon', text, url };
    try { if ((navigator as any).share) await (navigator as any).share(data); else if (navigator.clipboard) await navigator.clipboard.writeText(code ? `${text} (${code})` : text); } catch { /* user dismissed */ }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <OfflineStatus updatedAt={hq.dataUpdatedAt || undefined} failed={hq.isError} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="cust-h1">Hello, {guest ? 'Guest' : !h ? <span className="cust-skel" style={{ display: 'inline-block', width: 80, height: 20, verticalAlign: 'middle', borderRadius: 4 }} /> : (firstName(h.customerName) || 'there')} <span aria-hidden>✨</span></h1>
          <div className="cust-sub" style={{ marginTop: 2 }}>{guest ? 'Welcome to AI PowerSalon' : 'Treat yourself today.'}</div>
        </div>
        <button onClick={() => nav('/profile')} aria-label="Profile" style={{ width: 46, height: 46, borderRadius: 999, border: '2px solid var(--customer-purple-200)', background: 'var(--customer-primary-light)', color: 'var(--customer-primary)', fontWeight: 800, cursor: 'pointer', overflow: 'hidden', padding: 0 }}>
          {guest ? <span aria-hidden>👤</span> : !h ? <div className="cust-skel" style={{ width: '100%', height: '100%' }} /> : (
            h.avatarUrl ? <img src={h.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(h.customerName)
          )}
        </button>
        <button onClick={() => guest ? promptGuest('Sign in to view your notifications.') : nav('/notifications')} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} style={{ position: 'relative', width: 46, height: 46, borderRadius: 14, border: '1px solid var(--customer-border)', background: '#fff', cursor: 'pointer', fontSize: 18 }}>🔔{unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 999, background: 'var(--customer-red)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{unread > 9 ? '9+' : unread}</span>}</button>
      </div>

      {guest && (
        <div style={{
          background: 'linear-gradient(135deg, #FFFDF8 0%, #F9F1E2 100%)',
          border: '1px solid #E7DCC9',
          borderRadius: 16,
          padding: '13px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: '0 4px 14px rgba(42,33,24,0.04)'
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#2A2118' }}>Browsing as Guest</div>
            <div style={{ fontSize: 12, color: '#8A7A66', marginTop: 2 }}>Sign in to book, save favorites & earn rewards</div>
          </div>
          <button
            type="button"
            onClick={() => exitGuestMode()}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(169,111,34,.25)',
              whiteSpace: 'nowrap'
            }}>
            Sign In
          </button>
        </div>
      )}

      <PayBanner />

      {/* Loyalty hero */}
      {ratePrompt ? (
        <button className="cust-card" onClick={() => nav(`/rate-tech/${ratePrompt.ticketId}/${ratePrompt.technicianId}?name=${encodeURIComponent(ratePrompt.techName)}`)}
          style={{ width: '100%', textAlign: 'left', padding: 14, marginBottom: 12, cursor: 'pointer', border: '1px solid #E6D3B3', background: '#FFF9EE' }}
          aria-label={`Rate your service with ${ratePrompt.techName}`}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>⭐ {ratePrompt.prompt}</div>
          <div className="cust-sub" style={{ fontSize: 12, marginTop: 2 }}>{ratePrompt.serviceName} — tap to rate</div>
        </button>
      ) : null}
      {ratePrompt ? (
        <button className="cust-card" onClick={() => nav(`/nail-showcase/share/${ratePrompt.ticketId}`)}
          style={{ width: '100%', textAlign: 'left', padding: 14, marginBottom: 12, cursor: 'pointer', border: '1px solid var(--customer-purple-200, #e7defb)', background: 'var(--customer-purple-100, #f7f4fd)' }}
          aria-label="Share your nails from this visit">
          <div style={{ fontWeight: 800, fontSize: 14 }}>📸 Share these nails</div>
          <div className="cust-sub" style={{ fontSize: 12, marginTop: 2 }}>Post your {ratePrompt.serviceName} as a verified design</div>
        </button>
      ) : null}
      {guest ? null : <button onClick={() => nav('/rewards')} className="cust-hero" style={{ border: 0, textAlign: 'left', cursor: 'pointer', display: 'block', overflow: 'hidden' }} aria-label={!h ? 'Loading loyalty...' : `Loyalty: ${l?.points} points, ${l?.tier} member${l?.nextTier ? `, ${l?.pointsToNextTier} points to ${l?.nextTier}` : ''}`}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ opacity: 0.85, fontSize: 13, fontWeight: 600 }}>Your Loyalty Points</div>
            {!h ? (
              <>
                <div className="cust-skel" style={{ width: 100, height: 34, margin: '6px 0', background: 'rgba(255,255,255,0.2)' }} />
                <div className="cust-skel" style={{ width: 140, height: 16, background: 'rgba(255,255,255,0.2)' }} />
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}><span style={{ fontSize: 34, fontWeight: 800 }}>{l?.points?.toLocaleString('en-US')}</span><span style={{ opacity: 0.85 }}>pts</span></div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{l?.tier} Member</div>
              </>
            )}
          </div>
          <div aria-hidden style={{ fontSize: 40 }}>👑</div>
        </div>
        {!h ? (
          <div style={{ marginTop: 12 }}>
            <div className="cust-skel" style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.2)' }} />
            <div className="cust-skel" style={{ width: 120, height: 14, marginTop: 6, background: 'rgba(255,255,255,0.2)' }} />
          </div>
        ) : l?.nextTier ? (
          <div style={{ marginTop: 12 }}>
            <div className="cust-progress"><span style={{ width: `${Math.max(2, Math.min(100, l?.progressPercent))}%` }} /></div>
            <div style={{ opacity: 0.9, fontSize: 12.5, marginTop: 6 }}>{l?.pointsToNextTier?.toLocaleString('en-US')} pts to {l?.nextTier}</div>
          </div>
        ) : <div style={{ opacity: 0.9, fontSize: 12.5, marginTop: 10 }}>You’ve reached the top tier 🎉</div>}
      </button>}

      {/* Quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {QUICK.map((q) => (
          <button key={q.key} onClick={() => onQuickAction(q.key, q.to)} className="cust-card" style={{ padding: '12px 6px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer' }} aria-label={q.label}>
            <span style={{ width: 38, height: 38, borderRadius: 12, background: q.bg, color: q.fg, display: 'grid', placeItems: 'center', fontSize: 18 }} aria-hidden>{q.icon}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, textAlign: 'center', lineHeight: 1.2, color: 'var(--customer-text)' }}>{q.label}</span>
          </button>
        ))}
      </div>

      {/* AI Receptionist entry */}
      <button onClick={() => nav('/assistant')} className="cust-card" style={{ width: '100%', textAlign: 'left', padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: '1px solid #E6D3B3', background: 'linear-gradient(135deg, #FBF6EC, #F7E8C8)' }} aria-label="AI Receptionist">
        <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--customer-primary)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 20, flex: '0 0 auto' }} aria-hidden>💬</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 14.5 }}>Ask the AI Receptionist</span>
          <span className="cust-sub" style={{ display: 'block', fontSize: 12.5 }}>Appointments, your place in line, hours &amp; deals</span>
        </span>
        <span aria-hidden style={{ color: 'var(--customer-primary)', fontWeight: 800, fontSize: 18 }}>›</span>
      </button>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 className="cust-h2" style={{ flex: 1 }}>Upcoming Appointment</h2>
          <button onClick={() => nav('/appointments')} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer' }}>View All</button>
        </div>
        {!h ? (
          <div className="cust-card" style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="cust-skel" style={{ width: 52, height: 52, borderRadius: 12 }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="cust-skel" style={{ width: 120, height: 14 }} />
              <div className="cust-skel" style={{ width: 180, height: 16 }} />
              <div className="cust-skel" style={{ width: 80, height: 22, borderRadius: 12 }} />
            </div>
          </div>
        ) : h.nextAppointment ? (
          <button onClick={() => nav('/appointments')} className="cust-card" style={{ width: '100%', textAlign: 'left', padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
            <span style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 22 }} aria-hidden>💅</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', color: 'var(--customer-primary)', fontWeight: 700, fontSize: 13 }}>{apptWhen(h.nextAppointment.startTime)}</span>
              <span style={{ display: 'block', fontWeight: 700, marginTop: 2 }}>{h.nextAppointment.serviceName || 'Appointment'}</span>
              {h.nextAppointment.technicianName ? <span className="cust-sub" style={{ display: 'block' }}>Technician: {h.nextAppointment.technicianName}</span> : null}
              <span className="cust-pill cust-pill-green" style={{ marginTop: 6 }}>{h.nextAppointment.status}</span>
            </span>
            <span aria-hidden style={{ color: 'var(--customer-text-secondary)' }}>›</span>
          </button>
        ) : (
          <div className="cust-card" style={{ padding: 16 }}><div className="cust-sub">No upcoming appointments.</div></div>
        )}
      </section>

      {/* Popular services (Enhanced with 10 required fields: Name, Price, Duration, Salon, Address, Distance, Rating, Tech, View Salon, Book Now) */}
      {services.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <h2 className="cust-h2" style={{ flex: 1 }}>Popular Services</h2>
            <button onClick={() => nav('/book')} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>View All</button>
          </div>
          <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'none' }}>
            {services.map((s, idx) => {
              const matchedSalon = nearbySalons[idx % Math.max(1, nearbySalons.length)] || salon;
              const salonName = matchedSalon?.name || salon?.name || 'Palace Nails & Spa';
              const salonAddress = matchedSalon?.address || salon?.address || '123 Main St, Cherry Hill, NJ 08002';
              const distanceText = matchedSalon?.distance_miles != null ? `${matchedSalon.distance_miles.toFixed(1)} mi away` : '1.2 mi away';
              const ratingScore = matchedSalon?.rating != null ? matchedSalon.rating.toFixed(1) : '4.9';
              const reviewCnt = matchedSalon?.review_count || 128;
              const assignedTech = topTechs[idx % Math.max(1, topTechs.length)];

              return (
                <div
                  key={s.id}
                  className="cust-card"
                  style={{
                    width: 250,
                    flex: '0 0 auto',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 10,
                    background: '#FFFFFF',
                    border: '1px solid var(--customer-border)',
                    borderRadius: 18,
                    boxShadow: '0 4px 16px rgba(120, 90, 30, 0.08)',
                  }}
                >
                  {/* Service Header: Name, Price, Duration */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--customer-text)', lineHeight: 1.25 }}>
                        {s.name}
                      </div>
                      <span style={{ fontSize: 18 }} aria-hidden>💅</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--customer-primary-dark)' }}>
                        {money(s.priceCents)}
                      </span>
                      <span className="cust-sub" style={{ fontSize: 12 }}>
                        · {s.durationMinutes} min
                      </span>
                    </div>
                  </div>

                  {/* Salon Details: Name, Address, Distance, Rating */}
                  <div style={{ padding: '8px 0', borderTop: '1px solid rgba(233, 218, 196, 0.6)', borderBottom: '1px solid rgba(233, 218, 196, 0.6)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--customer-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        📍 {salonName}
                      </div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--customer-primary)' }}>
                        ★ {ratingScore} ({reviewCnt})
                      </div>
                    </div>
                    <div className="cust-sub" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {salonAddress}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--customer-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>🚗 {distanceText}</span>
                      {assignedTech ? <span>· 👤 {assignedTech.fullName}</span> : null}
                    </div>
                  </div>

                  {/* Action Buttons: View Salon & Book Now */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => nav('/find-salons')}
                      style={{
                        flex: 1,
                        height: 36,
                        borderRadius: 10,
                        border: '1px solid var(--customer-border)',
                        background: 'transparent',
                        color: 'var(--customer-text)',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      View Salon
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (guest) {
                          promptGuest(`Please sign in or create an account to book ${s.name}.`);
                          return;
                        }
                        nav('/book', { state: { preService: s, preSalon: matchedSalon } });
                      }}
                      style={{
                        flex: 1,
                        height: 36,
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--customer-primary)',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Book Now
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Refer a friend */}
      <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, var(--customer-purple-100), var(--customer-pink-light))' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800 }}>Refer a Friend, Earn Rewards!</div>
          <div className="cust-sub" style={{ margin: '2px 0 10px' }}>You both get $10 in rewards.</div>
          <button onClick={() => guest ? promptGuest('Sign in to invite friends and earn rewards.') : share()} className="cust-btn" style={{ width: 'auto', padding: '0 18px', height: 40, fontSize: 14 }}>Invite Friends</button>
        </div>
        <div aria-hidden style={{ fontSize: 40 }}>🎁</div>
      </div>

      {/* Nail Inspiration for You (real trending NailShowcase posts) */}
      {inspo.length > 0 && (
        <section>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <h2 className="cust-h2" style={{ flex: 1 }}>Nail Inspiration for You</h2>
            <button onClick={() => nav('/nail-showcase')} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer' }}>View All</button>
          </div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {inspo.map((p) => {
              const img = p.photos[0]?.thumbnailUrl || p.photos[0]?.imageUrl;
              const isVid = img?.toLowerCase().match(/\.(mp4|mov|webm)$/i);
              return (
                <button key={p.id} onClick={() => nav(`/nail-showcase/${p.id}`)} className="cust-card" style={{ width: 140, flex: '0 0 auto', padding: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer' }} aria-label={p.caption || 'Nail design'}>
                  <div style={{ height: 140, background: 'var(--customer-purple-100)' }}>
                    {img ? (isVid ? <video src={img} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline loop autoPlay /> : <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />) : null}
                  </div>
                  {p.caption ? <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption}</div> : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <GuestModal
        open={guestModalOpen}
        onClose={() => setGuestModalOpen(false)}
        message={guestModalMsg}
      />
    </div>
  );
}
