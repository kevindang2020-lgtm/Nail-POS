import { useEffect, useState } from 'react';
import { SplashScreen } from '@capacitor/splash-screen';
import logoImage from '../../public/brand/taptopay.png';

export function AnimatedSplash({ isReady = true, onFinish }: { isReady?: boolean; onFinish?: () => void }) {
  const [stage, setStage] = useState<'intro' | 'outro' | 'done'>('intro');
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  useEffect(() => {
    // Hide the native splash immediately so our web splash takes over seamlessly
    SplashScreen.hide().catch(() => {});

    // Ensure splash displays at least 2s for brand presence
    const t = setTimeout(() => setMinTimeElapsed(true), 2000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (stage === 'intro' && minTimeElapsed && isReady) {
      setStage('outro');
    }
  }, [stage, minTimeElapsed, isReady]);

  useEffect(() => {
    if (stage === 'outro') {
      const tOut = setTimeout(() => {
        setStage('done');
        if (onFinish) onFinish();
      }, 600);
      return () => clearTimeout(tOut);
    }
  }, [stage, onFinish]);

  // Safety fallback: never keep user stuck longer than 3.5s even if network is slow
  useEffect(() => {
    const safety = setTimeout(() => {
      setStage((prev) => (prev === 'intro' ? 'outro' : prev));
    }, 3500);
    return () => clearTimeout(safety);
  }, []);

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
        <img src={logoImage} alt="AI PowerSalon" style={{ width: 220, height: 'auto', display: 'block' }} />
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
