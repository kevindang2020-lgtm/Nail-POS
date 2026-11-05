// Branding.tsx — 23-inch spec §13: the SALON's identity on its customer display — its logo, its name, its tagline and
// (when it wants) the branch. "Do not permanently hard-code AI PowerSalon as the salon identity": the platform stays a
// quiet "Powered by AI PowerSalon". Everything comes from the server's CustomerDisplayBranding for this device.
import { useState } from 'react';
import type { CustomerDisplayBranding } from '@aipowersalon/api-contracts/customer';
import { mediaUrl } from './api';
import { useT } from './i18n';

const initialOf = (name: string) => (name.trim().match(/[A-Za-z0-9]/)?.[0] ?? '★').toUpperCase();

/** The salon's logo, or its initial when it has none (or the picture will not load) — never the platform's logo. */
export function SalonMark({ branding, salonName, className = 'salon-mark' }: { branding?: CustomerDisplayBranding; salonName: string; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = branding?.logoUrl ? mediaUrl(branding.logoUrl) : null;
  if (url && broken !== url) return <img className={`${className} salon-logo`} src={url} alt="" draggable={false} onError={() => setBroken(url)} />;
  return <div className={`${className} salon-mono`} aria-hidden="true">{initialOf(branding?.salonName || salonName || '')}</div>;
}

export function SalonBrand({ branding, salonName }: { branding?: CustomerDisplayBranding; salonName: string }) {
  const name = branding?.salonName || salonName;
  const sub = [branding?.tagline, branding?.branchName].filter(Boolean).join(' · ');
  return (
    <div className="salon-brand">
      <SalonMark branding={branding} salonName={salonName} />
      <div className="salon-text">
        {name ? <div className="salon-name serif">{name}</div> : null}
        {sub ? <div className="salon-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

export function PoweredBy() {
  const t = useT();
  return <div className="powered-by">{t('app.poweredBy')}</div>;
}
