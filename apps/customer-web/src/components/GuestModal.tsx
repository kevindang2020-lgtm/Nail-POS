import React from 'react';
import { exitGuestMode } from '../auth/guest';

interface GuestModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actionText?: string;
}

export function GuestModal({
  open,
  onClose,
  title = 'Sign In Required',
  message = 'Please sign in or create an account to book appointments, manage your visits, and earn loyalty rewards.',
  actionText = 'Sign In or Register',
}: GuestModalProps) {
  if (!open) return null;

  const handleSignIn = () => {
    onClose();
    exitGuestMode();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(20, 16, 12, 0.65)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#FFFDF9',
          borderRadius: 22,
          padding: '28px 24px 22px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
          border: '1px solid #E7DCC9',
          textAlign: 'center',
          animation: 'guestPop .25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #F9F1E2 0%, #EFE1C9 100%)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
            border: '1px solid #DBCAB0',
            boxShadow: '0 4px 12px rgba(169,111,34,.15)',
          }}
        >
          <span style={{ fontSize: 26 }} role="img" aria-label="crown">
            👑
          </span>
        </div>

        <h3
          style={{
            fontFamily: 'Georgia, serif',
            fontSize: 21,
            fontWeight: 700,
            color: '#2A2118',
            margin: '0 0 8px',
          }}
        >
          {title}
        </h3>

        <p
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            color: '#70604E',
            margin: '0 0 22px',
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={handleSignIn}
            style={{
              width: '100%',
              height: 48,
              borderRadius: 14,
              border: 'none',
              background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 55%, #84561A 100%)',
              color: '#FFFDF8',
              fontFamily: 'Georgia, serif',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 6px 18px rgba(169,111,34,.32)',
            }}
          >
            {actionText}
          </button>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 14,
              border: '1px solid #E7DCC9',
              background: '#FFFFFF',
              color: '#655543',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Continue Browsing
          </button>
        </div>
      </div>
      <style>{`
        @keyframes guestPop {
          0% { transform: scale(0.92); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
