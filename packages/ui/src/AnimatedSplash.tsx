import { useEffect, useState, useRef } from 'react';

/** onMount: the app hides its NATIVE splash here (Capacitor's SplashScreen.hide()) so this web splash takes over; the ui kit itself stays free of Capacitor. */
export function AnimatedSplash({ onFinish, onMount, ready = true }: { onFinish?: () => void; onMount?: () => void; ready?: boolean }) {
  const [stage, setStage] = useState<'intro' | 'outro' | 'done'>('intro');
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const finishCalledRef = useRef(false);

  useEffect(() => {
    // Hide the native splash immediately so our web splash takes over seamlessly
    try { onMount?.(); } catch { /* ignore */ }

    // Minimum logo display time: 1.5s
    const minTimer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 1500);

    // Safety timeout: max 5s so splash never gets stuck under any network issue
    const maxTimer = setTimeout(() => {
      setStage((prev) => (prev === 'intro' ? 'outro' : prev));
    }, 5000);

    return () => { clearTimeout(minTimer); clearTimeout(maxTimer); };
  }, [onMount]);

  useEffect(() => {
    if (stage === 'intro' && minTimeElapsed && ready) {
      setStage('outro');
    }
  }, [stage, minTimeElapsed, ready]);

  useEffect(() => {
    if (stage === 'outro') {
      const t = setTimeout(() => {
        setStage('done');
        if (onFinish && !finishCalledRef.current) {
          finishCalledRef.current = true;
          onFinish();
        }
      }, 600); // 600ms fade out
      return () => clearTimeout(t);
    }
  }, [stage, onFinish]);

  if (stage === 'done') return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 999999,
        backgroundColor: '#fdfefb',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        opacity: stage === 'outro' ? 0 : 1,
        transition: 'opacity 0.6s ease-in-out',
        pointerEvents: 'none',
      }}
    >
      <style>{`
        @keyframes splashScaleUp {
          0% { transform: scale(0.9); opacity: 0; }
          40% { transform: scale(1.05); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes splashShimmer {
          0% { transform: translateX(-150%) skewX(-20deg); }
          100% { transform: translateX(150%) skewX(-20deg); }
        }
      `}</style>
      <div style={{ position: 'relative', overflow: 'hidden', animation: 'splashScaleUp 1s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' }}>
        <img src="/brand/aipowersalon-logo.png" alt="AI PowerSalon" style={{ width: 280, height: 'auto', display: 'block' }} />
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)',
          animation: 'splashShimmer 1.5s ease-in-out 0.6s',
          opacity: 0.9, pointerEvents: 'none'
        }} />
      </div>
    </div>
  );
}
