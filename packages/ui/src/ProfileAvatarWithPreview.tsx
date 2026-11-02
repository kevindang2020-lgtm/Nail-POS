import React, { useState } from 'react';

export interface ProfileAvatarProps {
  name: string;
  url?: string | null;
  size?: number;
  type?: 'customer' | 'technician' | 'admin' | 'superadmin' | string;
  badgeLabel?: string;
  subtitle?: string;
  style?: React.CSSProperties;
  showPreview?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  /** the tooltip when the picture opens a preview; default: the app-wide resolver below (English unless an app sets one) */
  previewTitle?: string;
}

// packages/ui has no i18n (English + Vietnamese POS mandate, WP-C4): an app that translates (the POS) registers ONE resolver
// at start-up; it runs at render, so a language switch re-labels the tooltip. Apps that do not register keep the English.
let previewTitleOf: (name: string) => string = (name) => `Click to view profile picture of ${name}`;
export function setAvatarPreviewTitle(fn: (name: string) => string): void { previewTitleOf = fn; }

const envBase = (import.meta as any).env?.VITE_LIVE_IMAGE_BASE;
// Security Deep Scan A5: there is NO default third-party bucket any more. The developer-era fallback
// (power-salon-bucket.s3.us-east-2…, not an AIPowerSalon-owned bucket) sent every staff/Super Admin avatar request — IP
// and timing — to whoever owns that name, and let them swap the images. Without VITE_LIVE_IMAGE_BASE a bare key shows
// initials; full https URLs and same-origin paths (/media/…) work as before.
const LIVE_IMAGE_BASE: string | null = envBase ? (envBase.endsWith('/') ? envBase : `${envBase}/`) : null;

export function resolveAvatarUrl(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // If already a full HTTP/HTTPS URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // A same-origin path served by our own API (e.g. /media/…)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  if (!LIVE_IMAGE_BASE) return null;

  // If path contains 'images/' (e.g. 'uploads/images/avatar-1787745385785.png')
  if (trimmed.includes('images/')) {
    const imageName = trimmed.split('images/').pop()?.replace(/^\/+/, '');
    if (imageName) {
      return `${LIVE_IMAGE_BASE}${imageName}`;
    }
  }

  // Pure filename key fetched from DB (e.g. 'avatar-1787745385785.png')
  const imageName = trimmed.replace(/^.*[/\\]/, '').replace(/^\/+/, '');
  if (!imageName) return null;

  return `${LIVE_IMAGE_BASE}${imageName}`;
}

export function ProfileAvatarWithPreview({
  name,
  url,
  size = 28,
  type = 'customer',
  badgeLabel,
  subtitle,
  style,
  showPreview = true,
  onClick,
  previewTitle,
}: ProfileAvatarProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const resolvedUrl = imgError ? null : resolveAvatarUrl(url);

  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();

  const isTech = type === 'technician';
  const isAdmin = type === 'admin' || type === 'superadmin' || type === 'super-admin';
  const bg = isAdmin ? '#E8F0FE' : isTech ? '#FDF3E7' : '#F1E3C8';
  const border = isAdmin ? '#B6D0F7' : isTech ? '#E8C59A' : '#E4D7BE';
  const fg = isAdmin ? '#1967D2' : isTech ? '#C97A1E' : '#A96F22';

  const badgeText = badgeLabel || (
    type === 'superadmin' || type === 'super-admin'
      ? 'Super Admin Profile'
      : type === 'admin'
      ? 'Admin Profile'
      : isTech
      ? 'Technician Profile'
      : 'Customer Profile'
  );
  const badgeBg = isAdmin ? '#E8F0FE' : isTech ? '#FBF1DC' : '#EDE7F6';
  const badgeColor = isAdmin ? '#1967D2' : isTech ? '#9A6B12' : '#5B4699';

  const handleAvatarClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
    if (showPreview) {
      e.stopPropagation();
      setPreviewOpen(true);
    }
  };

  return (
    <>
      <span
        title={showPreview ? (previewTitle ?? previewTitleOf(name)) : name}
        onClick={handleAvatarClick}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flex: 'none',
          cursor: showPreview ? 'pointer' : 'default',
          border: `1.5px solid ${border}`,
          background: bg,
          color: fg,
          fontWeight: 800,
          fontSize: Math.max(9, Math.floor(size * 0.4)),
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          verticalAlign: 'middle',
          ...style,
        }}
        onMouseEnter={(e) => {
          if (showPreview) {
            e.currentTarget.style.transform = 'scale(1.08)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
          }
        }}
        onMouseLeave={(e) => {
          if (showPreview) {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)';
          }
        }}
      >
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt={name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => {
              setImgError(true);
            }}
          />
        ) : null}
        <span style={{ display: resolvedUrl ? 'none' : 'inline' }}>{initials}</span>
      </span>

      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Profile picture preview for ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            setPreviewOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(24, 18, 12, 0.75)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#FFFDF8',
              border: '1px solid #EAE0D0',
              borderRadius: 20,
              padding: 24,
              maxWidth: 380,
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <button
              onClick={() => setPreviewOpen(false)}
              title="Close preview"
              style={{
                position: 'absolute',
                top: 14,
                right: 14,
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '1px solid #E4D7BE',
                background: '#F7EFE1',
                color: '#6A5A46',
                fontWeight: 800,
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>

            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  padding: '2px 10px',
                  borderRadius: 99,
                  background: badgeBg,
                  color: badgeColor,
                }}
              >
                {badgeText}
              </span>
              <h3 style={{ margin: '8px 0 2px', fontSize: 19, fontWeight: 800, color: '#2B2319' }}>
                {name}
              </h3>
              {subtitle && <div style={{ fontSize: 12.5, color: '#7A6B58' }}>{subtitle}</div>}
            </div>

            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `4px solid ${border}`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {resolvedUrl ? (
                <img
                  src={resolvedUrl}
                  alt={name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: 64, fontWeight: 800, color: fg }}>{initials}</span>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#8C7C68', marginTop: 4 }}>
              🔍 Profile Picture Preview
            </div>
          </div>
        </div>
      )}
    </>
  );
}
