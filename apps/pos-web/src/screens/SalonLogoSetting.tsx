// SalonLogoSetting.tsx — Settings → Receipts & Branding → Salon logo (23-inch dual-screen spec §13). ONE picture, shown
// on the salon's receipts and at the top of every one of its customer displays. Upload replaces the previous logo (the
// server removes the old file); Remove takes it off both. The picture is prepared in the browser (salonLogoImage.ts).
import { useEffect, useRef, useState } from 'react';
import { posSettingsApi, type SalonLogoView } from '../api/posSettingsApi';
import { mediaUrl } from '../api/posDisplayAdsApi';
import { LOGO_RULES, prepareLogo } from './salonLogoImage';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Shown = Pick<SalonLogoView, 'url' | 'width' | 'height'> | null;

export function SalonLogoSetting({ onChanged }: {
  /** Told after a successful upload (true) or removal (false) — the receipts form keeps its "logo" box in step. */
  onChanged?: (hasLogo: boolean) => void;
}) {
  const [logo, setLogo] = useState<Shown | undefined>(undefined);   // undefined while loading
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [msg, setMsg] = useState<{ err: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    posSettingsApi.getLogo()
      .then((l) => { if (live) setLogo(l && typeof l.url === 'string' ? { url: l.url, width: l.width, height: l.height } : null); })
      .catch(() => { if (live) setLogo(null); });
    return () => { live = false; };
  }, []);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null); setBusy('upload');
    try {
      const p = await prepareLogo(f);
      const r = await posSettingsApi.uploadLogo(p.dataUrl);
      setLogo({ url: r.logoUrl, width: r.width, height: r.height });
      setMsg({ err: false, text: t('pos.logo_saved_receipts_use_it_now_d6n3') });
      onChanged?.(true);
    } catch (e: any) {
      setMsg({ err: true, text: e?.message || t('pos.the_logo_could_not_be_uploaded') });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = '';   // choosing the same file again still uploads it
    }
  };
  const remove = async () => {
    setMsg(null); setBusy('remove');
    try {
      await posSettingsApi.removeLogo();
      setLogo(null);
      setMsg({ err: false, text: t('pos.logo_removed_within_15_seconds_your_o4p3') });
      onChanged?.(false);
    } catch (e: any) {
      setMsg({ err: true, text: e?.message || t('pos.the_logo_could_not_be_removed') });
    } finally { setBusy(null); }
  };

  return (
    <div data-testid="salon-logo-setting" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, background: '#FFFDF8' }}>
      <div style={{ width: 128, height: 72, flex: '0 0 auto', border: '1px dashed var(--line)', borderRadius: 8, display: 'grid', placeItems: 'center', background: '#fff', overflow: 'hidden' }}>
        {logo
          ? <img src={mediaUrl(logo.url)} alt={t('pos.salon_logo')} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span className="s muted">{logo === undefined ? t('pos.loading') : t('pos.no_logo_yet')}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div className="s"><b>{t('pos.salon_logo')}</b> {t('pos.printed_on_receipts_and_shown_at_1q6r')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn ghost" disabled={busy !== null || logo === undefined} onClick={() => file.current?.click()}>
            {busy === 'upload' ? t('pos.uploading') : logo ? t('pos.replace_logo') : t('pos.upload_logo')}
          </button>
          {logo ? <button type="button" className="btn ghost" disabled={busy !== null} onClick={remove}>{busy === 'remove' ? t('pos.removing') : t('pos.remove_logo')}</button> : null}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('pos.salon_logo_file')} hidden onChange={(e) => { void upload(e.target.files?.[0]); }} />
        </div>
        <div className="s muted">{t('pos.png_with_a_transparent_background_works_hp9k')}{' '}{LOGO_RULES.longEdge} {t('pos.pixels')}</div>
        {msg ? <div className={msg.err ? 'err' : 's'} role={msg.err ? 'alert' : 'status'}>{msg.text}</div> : null}
      </div>
    </div>
  );
}
