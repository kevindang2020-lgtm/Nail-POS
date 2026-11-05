/**
 * SalonTechsScreen — "All Technicians" for one partner salon (doc Flow 2). Route: /salons/:salonId/techs.
 * Cards: avatar · name · title · ★ rating (count) · specialties · featured thumbs · next available · badges,
 * with View Profile (→ /techs/:slug) and Book. Book keeps the single-salon-session rule used everywhere else:
 * if this salon is the signed-in salon it preselects the tech in /book; otherwise it shows the honest note.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerApi, type PublicTechCard, type NSNextAvailable } from '../api/customerApi';
import { useAuth } from '../auth/AuthContext';

export default function SalonTechsScreen() {
  const { salonId = '' } = useParams();
  const nav = useNavigate();
  const { principal } = useAuth();
  const [techs, setTechs] = useState<PublicTechCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    customerApi.salonTechnicians(salonId)
      .then((x) => { if (on) setTechs(x.technicians); })
      .catch((e: any) => { if (on) setError(e?.message || 'Could not load technicians.'); });
    return () => { on = false; };
  }, [salonId]);

  const mySalon = useMemo(() => principal?.branchId != null && principal.branchId === salonId, [principal, salonId]);
  const fmtNext = (n: NSNextAvailable | null) => (n ? `${n.date} ${n.startTime}` : null);

  return (
    <div style={{ padding: 18, paddingBottom: 96 }}>
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
        <h1 className="cust-h1" style={{ fontSize: 20, margin: 0 }}>Technicians</h1>
      </div>

      {error ? <div className="cust-sub" style={{ marginTop: 14, fontSize: 13 }}>{error}</div> : null}
      {!error && techs === null ? <div className="cust-sub" style={{ marginTop: 14, fontSize: 13 }}>Loading…</div> : null}
      {techs && techs.length === 0 ? <div className="cust-sub" style={{ marginTop: 14, fontSize: 13 }}>No public technician profiles at this salon yet.</div> : null}

      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {(techs ?? []).map((t) => (
          <div key={t.publicSlug} className="cust-card" data-testid="salon-tech-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', background: '#EFE6D6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {t.avatarUrl ? <img src={t.avatarUrl} alt={t.displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '💅'}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{t.displayName} {t.isFeatured ? <span title="Featured" style={{ color: '#C9962E' }}>⭐</span> : null}</div>
                {t.title ? <div className="cust-sub" style={{ fontSize: 12 }}>{t.title}</div> : null}
                <div className="cust-sub" style={{ fontSize: 12.5, marginTop: 2 }}>
                  ★ {Number(t.averageRating).toFixed(1)}{t.reviewCount ? ` (${t.reviewCount} reviews)` : ' (new)'}
                  {fmtNext(t.nextAvailable) ? ` · Next: ${fmtNext(t.nextAvailable)}` : ''}
                </div>
                {Array.isArray(t.specialties) && t.specialties.length ? (
                  <div className="cust-sub" style={{ fontSize: 12, marginTop: 3 }}>{t.specialties.slice(0, 4).join(' • ')}</div>
                ) : null}
                {Array.isArray(t.badges) && t.badges.length ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                    {t.badges.map((b: string) => <span key={b} style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 99, background: '#F3E8D2', color: '#7A5414', fontWeight: 600 }}>{b}</span>)}
                  </div>
                ) : null}
              </div>
            </div>
            {Array.isArray(t.featuredPortfolioPhotos) && t.featuredPortfolioPhotos.length ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {t.featuredPortfolioPhotos.slice(0, 3).map((u: string) => (
                  <img key={u} src={u} alt="Nail design" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover' }} />
                ))}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className="cust-btn ghost"
                style={{
                  flex: mySalon && t.isBookable ? 1 : undefined,
                  width: mySalon && t.isBookable ? undefined : '100%',
                  padding: '9px 14px',
                  fontSize: 13,
                  fontWeight: 700,
                }}
                onClick={() => nav(`/techs/${t.publicSlug}`)}
              >
                View Profile
              </button>
              {t.isBookable && mySalon ? (
                <button
                  className="cust-btn"
                  style={{ flex: 1, padding: '9px 14px', fontSize: 13 }}
                  onClick={() => nav(`/book?techId=${t.technicianId}`)}
                >
                  Book
                </button>
              ) : null}
            </div>
            {t.isBookable && !mySalon ? (
              <div className="cust-sub" style={{ fontSize: 11.5, marginTop: 8, textAlign: 'center' }}>
                Sign in with this salon to book in-app
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
