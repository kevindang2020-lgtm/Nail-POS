// CardScanner.tsx — live camera scanning for gift cards (spec §11) using the native BarcodeDetector. Only mounted when
// scannerSupported() is true; on any camera/permission failure it shows a message and the receptionist enters the number
// manually. Calls onScan with the first payload that resolves to a usable card value, then the caller closes it.
import { useEffect, useRef, useState } from 'react';
import { extractCardNumber } from '../lib/barcode-core';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

// Minimal ambient type for the native BarcodeDetector (absent from the TS DOM lib).
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare const BarcodeDetector: { new (opts?: { formats?: string[] }): BarcodeDetectorLike };

const GOLD = 'var(--aps-orange,#A96F22)';
const MUTED = 'var(--muted,#7A6C57)';

export function CardScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a', 'itf'] });
        const tick = async () => {
          if (cancelled) return;
          try {
            const codes = await detector.detect(v);
            for (const c of codes) { const val = extractCardNumber(c.rawValue); if (val) { onScan(val); return; } }
          } catch { /* transient decode error — keep scanning */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { setErr(tx('pos.could_not_start_the_camera_check_lygu')); }
    })();
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onScan]);

  return (
    <div role="dialog" aria-label={tx('pos.scan_gift_card')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 360, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 700, color: GOLD }}>{tx('pos.scan_gift_card')}</div>
          <button onClick={onClose} aria-label={tx('pos.close_scanner')} style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: MUTED }}>×</button>
        </div>
        {err ? (
          <div style={{ color: '#a12d2d', fontSize: 13 }}>{err}</div>
        ) : (
          <>
            <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 8, background: '#000', aspectRatio: '4 / 3' }} />
            <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>{tx('pos.point_the_camera_at_the_card_c1mi')}</p>
          </>
        )}
      </div>
    </div>
  );
}
