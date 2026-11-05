import { useEffect, useState } from 'react';
import { SplashScreen } from '@capacitor/splash-screen';
import logoImage from '../../public/brand/AI_PowerSalon_Owner_App.png';

export function AnimatedSplash({ onFinish }: { onFinish?: () => void }) {
  const [stage, setStage] = useState<'intro' | 'outro' | 'done'>('intro');

  useEffect(() => {
    // Hide the native splash immediately so our web splash takes over seamlessly
    SplashScreen.hide().catch(() => {});

    // Animation sequence
    const t1 = setTimeout(() => setStage('outro'), 2000); // 2s to show logo
    const t2 = setTimeout(() => {
      setStage('done');
      if (onFinish) onFinish();
    }, 2600); // 600ms fade out

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onFinish]);

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
        <img src={logoImage} alt="AI PowerSalon" style={{ width: 260, height: 'auto', display: 'block', mixBlendMode: 'multiply' }} />
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
