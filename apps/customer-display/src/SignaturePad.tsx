// SignaturePad.tsx — a full-width drawing surface for the cardholder's signature on the customer-display iPad.
// Pointer-events cover touch (the iPad), pen, and mouse with one code path. The pad tracks whether anything has been
// drawn (so an empty pad can't be confirmed), exposes Clear, and on Confirm hands the parent a trimmed PNG data URL
// (canvas.toDataURL('image/png')). No card data is ever handled here — only the drawn mark.
import { useCallback, useEffect, useRef, useState } from 'react';

export function SignaturePad({ onConfirm, submitting, disabled }: { onConfirm: (pngDataUrl: string) => void; submitting: boolean; disabled?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Size the canvas backing store to its displayed CSS box × devicePixelRatio, so the line is crisp and coordinates map
  // 1:1. Re-run on resize/orientation change. Clears the pad (acceptable — the customer hasn't signed yet on first paint).
  const fit = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.max(1, Math.round(rect.width * dpr));
    c.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1c1a17';
    setHasInk(false);
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('orientationchange', fit); };
  }, [fit]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!; const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || submitting) return;
    e.preventDefault(); (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drawing.current = true; last.current = pos(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; if (!hasInk) setHasInk(true);
  };
  const up = () => { drawing.current = false; last.current = null; };

  const clear = () => { fit(); };
  const confirm = () => {
    const c = canvasRef.current; if (!c || !hasInk || submitting || disabled) return;
    onConfirm(c.toDataURL('image/png'));
  };

  return (
    <div className="kiosk-sign">
      <canvas
        ref={canvasRef}
        className="kiosk-sign-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        style={{ touchAction: 'none' }}
      />
      <div className="kiosk-sign-baseline"><span>Sign above</span></div>
      <div className="kiosk-sign-actions">
        <button type="button" className="kiosk-btn ghost" onClick={clear} disabled={submitting || !hasInk}>Clear</button>
        <button type="button" className="kiosk-btn solid" onClick={confirm} disabled={submitting || !hasInk}>
          {submitting ? 'Saving…' : 'Done'}
        </button>
      </div>
    </div>
  );
}
