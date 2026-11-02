// DisplayPreview.tsx — §57 "23-Inch Customer Display Preview": a 1920×1080 landscape screen, drawn to scale, with the
// check-in area on the left/centre and the advertising panel on the right (§5–§6), or the optional full-screen ad (§7).
// The ad itself is rendered by the SAME component the customer display uses (@aipowersalon/ui DisplayAdSlide), so the
// owner sees exactly how the image will be cropped. The check-in side is a labelled outline of the layout — no
// invented customers, services or prices (§115).
import type { CSSProperties } from 'react';
import { AD_PANEL_FRACTION, AdFallbackPanel, AdRotator, DisplayAdSlide, type AdSlideContent, type RotatingAd } from '@aipowersalon/ui';
import { mediaUrl } from '../../api/posDisplayAdsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const block = (h: string): CSSProperties => ({ height: h, borderRadius: '0.7cqw', background: 'rgba(122,90,46,.10)', border: '0.12cqw dashed rgba(122,90,46,.35)' });

function CheckInOutline({ salonName }: { salonName: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FBF7F0', padding: '1.6cqw 2cqw', gap: '1.2cqw', boxSizing: 'border-box' }} aria-label={t('pos.check_in_area')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1cqw' }}>
        <div style={{ width: '3.2cqw', height: '3.2cqw', borderRadius: '50%', background: 'rgba(122,90,46,.18)' }} />
        <div style={{ fontFamily: 'Playfair Display, serif', fontWeight: 700, fontSize: '1.7cqw', color: '#3b2b1d' }}>{salonName}</div>
      </div>
      <div style={{ fontSize: '0.95cqw', fontWeight: 700, color: '#8a6d1c', textTransform: 'uppercase', letterSpacing: '.06em' }}>{t('pos.check_in_area_stays_available_while_1s6a')}</div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: '1.4cqw', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1cqw' }}>
          <div style={{ fontSize: '1.25cqw', fontWeight: 700, color: '#3b2b1d' }}>{t('pos.appointment_check_in')}</div>
          <div style={block('3.6cqw')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.7cqw', flex: 1 }}>{Array.from({ length: 12 }, (_, i) => <div key={i} style={block('100%')} />)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1cqw' }}>
          <div style={{ fontSize: '1.25cqw', fontWeight: 700, color: '#3b2b1d' }}>{t('pos.walk_in_2')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.8cqw', flex: 1 }}>{Array.from({ length: 9 }, (_, i) => <div key={i} style={block('100%')} />)}</div>
          <div style={block('3.6cqw')} />
        </div>
      </div>
    </div>
  );
}

export function DisplayPreview({ ads, single, mode = 'panel', salonName, caption }: {
  /** A rotating playlist (Playlist / Display Preview tabs) … */
  ads?: readonly RotatingAd[];
  /** … or one ad being edited. */
  single?: AdSlideContent | null;
  mode?: 'panel' | 'fullscreen';
  salonName: string;
  caption?: string;
}) {
  const panel = single
    ? <DisplayAdSlide ad={single} resolveUrl={mediaUrl} />
    : <AdRotator ads={ads ?? []} resolveUrl={mediaUrl} fallback={<AdFallbackPanel salonName={salonName} />} />;
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', containerType: 'inline-size', borderRadius: 12, overflow: 'hidden', border: '6px solid #2b2420', boxShadow: '0 6px 18px rgba(0,0,0,.18)', background: '#000' } as CSSProperties} data-testid="display-preview">
        {mode === 'fullscreen'
          ? <div style={{ position: 'absolute', inset: 0 }}>{panel}</div>
          : (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `${(1 - AD_PANEL_FRACTION) * 100}% ${AD_PANEL_FRACTION * 100}%` }}>
              <CheckInOutline salonName={salonName} />
              <div style={{ position: 'relative', minWidth: 0 }}>{panel}</div>
            </div>
          )}
      </div>
      <figcaption style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
        {caption ?? (mode === 'fullscreen' ? t('pos.23_inch_customer_display_full_screen_yjgo') : t('pos.23_inch_customer_display_1920_1080_1qc5'))}
      </figcaption>
    </figure>
  );
}
