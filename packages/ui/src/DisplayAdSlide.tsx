// DisplayAdSlide.tsx — ONE renderer for a salon advertisement (23-inch dual-screen spec §47, §51–§57, §77–§78). The
// customer display plays it and the POS "23-Inch Customer Display Preview" shows it, so the owner sees exactly how the
// image will fit (§57) — two copies would drift.
//
// • The image is never distorted (§54): cover / smart crop fill the panel around a focus point; contain shows the whole
//   image over a blurred copy of itself instead of empty bars.
// • Image-only ads are just the image (§53). With text, a bottom scrim keeps it legible on any photo.
// • Text is rendered as text — never HTML (§77). The QR code is drawn here from the URL (§78), not an uploaded picture.
// • Sizes use container-query units, so the same slide scales from the 1366×768 panel to a 1920×1080 full screen.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';

/** §5: the advertising panel is the right ~35% of the 16:9 customer display (check-in keeps the left/centre). */
export const AD_PANEL_FRACTION = 0.35;
/** §60: one subtle cross-fade between ads — no reload, no flash. */
export const AD_CROSSFADE_MS = 800;

export interface AdSlideImage { url: string; width: number; height: number }
export interface AdSlideContent {
  image: AdSlideImage;
  fit: 'cover' | 'contain' | 'smart_crop';
  focalX: number; focalY: number;
  headline?: string | null; subheadline?: string | null; description?: string | null; ctaText?: string | null;
  qr?: { label: string; url: string } | null;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

/** A QR code as one SVG path (dark modules), with the standard 4-module quiet zone. null when the text cannot be encoded. */
export function qrPath(text: string): { size: number; d: string } | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(); const q = 4;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) { c++; continue; }
        let e = c; while (e < n && qr.isDark(r, e)) e++;
        d += `M${c + q} ${r + q}h${e - c}v1h${c - e}z`;
        c = e;
      }
    }
    return { size: n + 2 * q, d };
  } catch { return null; }
}

export function AdQrCode({ url, label, style }: { url: string; label: string; style?: CSSProperties }) {
  const p = useMemo(() => qrPath(url), [url]);
  if (!p) return null;
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6cqh', ...style }}>
      <svg viewBox={`0 0 ${p.size} ${p.size}`} role="img" aria-label={`QR code: ${label}`} style={{ width: '100%', height: 'auto', background: '#fff', borderRadius: '1.2cqh', display: 'block' }} shapeRendering="crispEdges">
        <path d={p.d} fill="#1b1410" />
      </svg>
      <figcaption style={{ fontSize: '1.7cqh', fontWeight: 600, color: '#fff', textAlign: 'center', lineHeight: 1.2 }}>{label}</figcaption>
    </figure>
  );
}

export function DisplayAdSlide({ ad, resolveUrl = (u) => u, onImageError, style }: {
  ad: AdSlideContent;
  /** Media URLs may be relative to the API (local storage) — the app turns them into loadable URLs. */
  resolveUrl?: (url: string) => string;
  onImageError?: () => void;
  style?: CSSProperties;
}) {
  const src = resolveUrl(ad.image.url);
  const contain = ad.fit === 'contain';
  const position = `${Math.round(clamp01(ad.focalX) * 1000) / 10}% ${Math.round(clamp01(ad.focalY) * 1000) / 10}%`;
  const hasText = !!(ad.headline || ad.subheadline || ad.description || ad.ctaText || ad.qr);
  const img: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' };
  return (
    <div className="aps-adslide" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#1b1410', containerType: 'size', ...style } as CSSProperties}>
      {contain ? <img src={src} alt="" aria-hidden draggable={false} style={{ ...img, objectFit: 'cover', filter: 'blur(28px) brightness(0.7)', transform: 'scale(1.15)' }} /> : null}
      <img
        src={src} alt={ad.headline || ''} draggable={false} onError={onImageError}
        style={{ ...img, objectFit: contain ? 'contain' : 'cover', objectPosition: contain ? '50% 50%' : position }}
      />
      {hasText ? (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14cqh 7cqw 6cqh',
          background: 'linear-gradient(to top, rgba(20,14,10,.88) 0%, rgba(20,14,10,.62) 55%, rgba(20,14,10,0) 100%)',
          color: '#fff', display: 'flex', alignItems: 'flex-end', gap: '4cqw',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {ad.headline ? <div style={{ fontFamily: 'Playfair Display, Georgia, serif', fontWeight: 700, fontSize: '5.6cqh', lineHeight: 1.08, letterSpacing: '0.01em', overflowWrap: 'anywhere' }}>{ad.headline}</div> : null}
            {ad.subheadline ? <div style={{ fontSize: '2.7cqh', fontWeight: 600, marginTop: '1cqh', opacity: 0.95, overflowWrap: 'anywhere' }}>{ad.subheadline}</div> : null}
            {ad.description ? <div style={{ fontSize: '2.2cqh', marginTop: '1.2cqh', opacity: 0.9, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{ad.description}</div> : null}
            {ad.ctaText ? <div style={{ display: 'inline-block', marginTop: '2.2cqh', padding: '1.1cqh 2.6cqh', borderRadius: '99px', background: '#c8a24a', color: '#1b1410', fontWeight: 700, fontSize: '2.2cqh' }}>{ad.ctaText}</div> : null}
          </div>
          {ad.qr ? <AdQrCode url={ad.qr.url} label={ad.qr.label} style={{ width: '16cqh', flex: '0 0 auto' }} /> : null}
        </div>
      ) : null}
    </div>
  );
}

export interface RotatingAd extends AdSlideContent { id: string; version?: number; durationSeconds: number }

/**
 * §58–§60: loop the playlist, each ad for its own duration, with a cross-fade. Only the current, the next (preloading)
 * and the previous (fading out) slides are mounted. Every rotation slot an ad fills is one DISPLAY: `onShown(adId, ms)`
 * fires when the slot ends (a lone ad starts a new slot each duration; a slot cut short by a new playlist or unmount is
 * reported with the time it actually had) — the display reports these (§108: displayed, never "viewed").
 * An empty playlist renders `fallback`.
 */
export function AdRotator({ ads, resolveUrl, onShown, fallback = null, style }: {
  ads: readonly RotatingAd[];
  resolveUrl?: (url: string) => string;
  onShown?: (adId: string, ms: number) => void;
  fallback?: ReactNode;
  style?: CSSProperties;
}) {
  const key = ads.map((a) => `${a.id}:${a.version ?? 0}:${a.durationSeconds}`).join('|');
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [slot, setSlot] = useState(0);
  const shown = useRef(onShown); shown.current = onShown;
  const current = ads.length ? ads[index % ads.length] : null;
  const currentId = current?.id ?? null;

  // a new playlist starts from the top
  useEffect(() => { setIndex(0); setPrev(null); }, [key]);
  // one slot = one display: measured from when the slot began to when it ends (timer, new playlist or unmount)
  useEffect(() => {
    if (!currentId) return;
    const began = Date.now();
    return () => shown.current?.(currentId, Date.now() - began);
  }, [currentId, key, slot]);
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => {
      if (ads.length < 2) { setSlot((x) => x + 1); return; }
      setPrev(index % ads.length); setIndex((i) => (i + 1) % ads.length);
    }, Math.max(1, current.durationSeconds) * 1000);
    return () => clearTimeout(t);
  }, [index, key, slot]);   // eslint-disable-line react-hooks/exhaustive-deps -- `ads` is captured by `key`

  if (!current) return <>{fallback}</>;
  const n = ads.length; const cur = index % n; const next = (cur + 1) % n;
  const mounted = [...new Set([cur, ...(n > 1 ? [next] : []), ...(prev !== null && prev < n ? [prev] : [])])];
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', ...style }} aria-live="off">
      {mounted.map((i) => (
        <div key={ads[i].id} aria-hidden={i !== cur} style={{ position: 'absolute', inset: 0, opacity: i === cur ? 1 : 0, transition: `opacity ${AD_CROSSFADE_MS}ms ease`, zIndex: i === cur ? 2 : 1 }}>
          <DisplayAdSlide ad={ads[i]} resolveUrl={resolveUrl} />
        </div>
      ))}
    </div>
  );
}

/**
 * §114: what the advertising panel shows when there is nothing to play (no ads, ads switched off, an image that would
 * not load): the salon's own name and logo with a welcome — never a blank panel, never another salon's anything.
 */
export function AdFallbackPanel({ salonName, logoUrl, lines = ['Welcome', 'Gift cards available', 'Book your next visit'], style }: {
  salonName: string; logoUrl?: string | null; lines?: readonly string[]; style?: CSSProperties;
}) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', containerType: 'size', background: 'linear-gradient(160deg,#2b1f16 0%,#4a3524 55%,#7a5a2e 100%)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3cqh', textAlign: 'center', padding: '6cqh 8cqw', ...style } as CSSProperties}>
      {logoUrl ? <img src={logoUrl} alt="" style={{ maxWidth: '55cqw', maxHeight: '18cqh', objectFit: 'contain' }} /> : null}
      <div style={{ fontFamily: 'Playfair Display, Georgia, serif', fontWeight: 700, fontSize: '5cqh', lineHeight: 1.1, overflowWrap: 'anywhere' }}>{salonName}</div>
      <div style={{ width: '18cqw', height: '0.4cqh', background: '#c8a24a', borderRadius: 4 }} />
      {lines.map((l, i) => <div key={i} style={{ fontSize: i === 0 ? '3.4cqh' : '2.5cqh', fontWeight: i === 0 ? 700 : 500, opacity: i === 0 ? 1 : 0.9 }}>{l}</div>)}
    </div>
  );
}
