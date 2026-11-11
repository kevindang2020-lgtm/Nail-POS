// ProfileMenu.tsx — top-bar identity for the POS shell.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Icon } from './tenant-nav';
import { ProfileAvatarWithPreview, resolveAvatarUrl } from '@aipowersalon/ui';
import type { Badges } from './tenant-access';
import { Trash2 } from "lucide-react";
import { POSSecuritySettingsModal } from './POSSecuritySettingsModal';
import { ScreenCheckDialog } from './ScreenCheckDialog';
import { readSpacing, saveSpacing, type Spacing } from './spacingPref';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';

function fileToSquareDataUrl(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(t('pos.canvas_unavailable'));
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) { URL.revokeObjectURL(url); reject(e as Error); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('pos.that_file_is_not_a_readable_1slk'))); };
    img.src = url;
  });
}

export function ProfileMenu({ badges }: { badges?: Badges }) {
  const { principal, logout } = useAuth();
  const nav = useNavigate();
  const go = (route: string) => { setMenuOpen(false); nav(route); };
  const name = principal?.fullName || principal?.role || t('pos.front_desk_2');
  const role = principal?.role || '';

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [spacing, setSpacing] = useState<Spacing>(() => readSpacing());   // Compact spacing (this device)
  const [editorOpen, setEditorOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [screenCheckOpen, setScreenCheckOpen] = useState(false);   // SUNMI mandates: the read-only Screen Check
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let on = true;
    api.get<{ avatarUrl: string | null }>('/pos/me/profile')
      .then((r) => { if (on) setAvatarUrl(r?.avatarUrl ? resolveAvatarUrl(r.avatarUrl) : null); })
      .catch(() => { /* fail-soft: show initials */ });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const pickPhoto = () => { setError(null); fileRef.current?.click(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(t('pos.please_choose_an_image_file')); return; }
    if (file.size > 12 * 1024 * 1024) { setError(t('pos.that_image_is_too_large_max_1s2e')); return; }
    setError(null);
    try {
      const dataUrl = await fileToSquareDataUrl(file);
      setPreview(dataUrl);
      setMenuOpen(false);
      setEditorOpen(true);
    } catch (err: any) { setError(err?.message || t('pos.could_not_read_that_image')); }
  };

  const save = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      const r = await api.patch<{ avatarUrl: string }>('/pos/me/avatar', { dataUrl: preview });
      const resolved = resolveAvatarUrl(r?.avatarUrl) || preview;
      setAvatarUrl(resolved);
      setEditorOpen(false); setPreview(null);
    } catch (err: any) { setError(err?.message || t('pos.could_not_save_your_photo_please_14j1')); }
    finally { setBusy(false); }
  };

  const removePhoto = async () => {
    setBusy(true); setError(null);
    try { await api.del('/pos/me/avatar'); setAvatarUrl(null); setMenuOpen(false); }
    catch (err: any) { setError(err?.message || t('pos.could_not_remove_your_photo')); }
    finally { setBusy(false); }
  };

  const Avatar = ({ url, big }: { url: string | null; big?: boolean }) => (
    <ProfileAvatarWithPreview
      name={name}
      url={url}
      size={big ? 56 : 32}
      type={role.toLowerCase().includes('owner') ? 'admin' : 'customer'}
      badgeLabel={role ? t('pos.v0_profile', { v0: String(role.toUpperCase()) }) : t('pos.user_profile')}
      subtitle={(principal as any)?.email || role}
      showPreview={true}
    />
  );

  const hasSettingsView = (principal?.permissions || []).includes('settings.view') || principal?.role === 'OWNER' || principal?.role === 'MANAGER';
  const notifCount = badges?.notifications || 0;
  const msgCount = badges?.messages || 0;

  return (
    <div className="who ml-auto md:ml-0" ref={rootRef} style={{ position: 'relative' }}>
      <button className="who-btn" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} title={t('pos.account')}>
        <span className="who-id">
          <span className="nm">{name}</span>
          <span className="rl">{role ? statusLabel('role', role.toLowerCase()) : ''}</span>
        </span>
        <Avatar url={avatarUrl} />
        <span className={`who-chev${menuOpen ? ' up' : ''}`}><Icon name="chevron" /></span>
      </button>

      {menuOpen && (
        <div className="who-menu" role="menu" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, left: 'auto' }}>
          <div className="who-head">
            <Avatar url={avatarUrl} big />
            <div className="who-head-id"><div className="nm">{name}</div><div className="rl">{role}</div></div>
          </div>

          {/* Mobile-Only Quick Access items for Notifications & Messages */}
          <div className="sm:hidden">
            <button
              className="who-item"
              role="menuitem"
              onClick={() => go('/tenant/inventory?tab=alerts')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="bell" /> {t('pos.notifications')}
              </span>
              {notifCount > 0 && (
                <span className="nbadge red" style={{ fontSize: 11, padding: '1px 6px' }}>
                  {notifCount > 99 ? '99+' : notifCount}
                </span>
              )}
            </button>
            <button
              className="who-item"
              role="menuitem"
              onClick={() => go('/messages')}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="mail" /> {t('pos.messages_2')}
              </span>
              {msgCount > 0 && (
                <span className="nbadge orange" style={{ fontSize: 11, padding: '1px 6px' }}>
                  {msgCount > 99 ? '99+' : msgCount}
                </span>
              )}
            </button>
            <div className="who-sep" />
          </div>

          <button className="who-item" role="menuitem" onClick={() => go('/tenant/account/overview')}>
            <Icon name="account" /> {t('pos.my_profile')}
          </button>
          <button className="who-item" role="menuitem" onClick={() => go('/tenant/account/security')}>
            <Icon name="lock" /> {t('pos.security_2fa')}
          </button>
          {hasSettingsView && (
            <button className="who-item" role="menuitem" onClick={() => go('/settings')}>
              <Icon name="management" /> {t('pos.salon_settings_2')}
            </button>
          )}
          {hasSettingsView && (
            <button className="who-item" role="menuitem" data-testid="open-screen-check" onClick={() => { setMenuOpen(false); setScreenCheckOpen(true); }}>
              <Icon name="management" /> {t('sunmi.menu')}
            </button>
          )}
          <div className="who-sep" />
          <button className="who-item" role="menuitem" onClick={pickPhoto}>
            <Icon name="account" /> {avatarUrl ? t('pos.change_photo') : t('pos.add_photo')}
          </button>
          {avatarUrl && (
            <button
              className="who-item danger"
              role="menuitem"
              onClick={removePhoto}
              disabled={busy}
            >
              <Trash2 size={16} />
              {t('pos.remove_photo')}
            </button>
          )}
          <button className="who-item" role="menuitem" onClick={() => { setMenuOpen(false); setSecurityModalOpen(true); }}>
            <Icon name="lock" /> {t('pos.pos_device_lock_setup')}
          </button>
          <button className="who-item" role="menuitemcheckbox" aria-checked={spacing === 'compact'} data-testid="spacing-toggle"
            onClick={() => { const next = spacing === 'compact' ? 'standard' : 'compact'; saveSpacing(next); setSpacing(next); }}>
            <Icon name="dashboard" /> {t('shell.spacing.compact')}{spacing === 'compact' ? ' ✓' : ''}
          </button>
          <div className="who-sep" />
          <button className="who-item" role="menuitem" onClick={async () => { setMenuOpen(false); await logout(); }}>
            <Icon name="lock" /> {t('pos.sign_out')}
          </button>
          {error && <div className="who-err">{error}</div>}
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onFile} />

      {editorOpen && preview && (
        <div className="modal-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) { setEditorOpen(false); setPreview(null); } }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={t('pos.profile_photo')}>
            <div className="modal-h">{t('pos.update_profile_photo')}</div>
            <div className="modal-b">
              <div className="ppreview"><img src={preview} alt={t('pos.new_profile_preview')} /></div>
              <p className="modal-note">{t('pos.this_is_how_your_photo_will_ylh9')}</p>
              {error && <div className="who-err">{error}</div>}
            </div>
            <div className="modal-f">
              <button className="btn ghost" onClick={() => { setEditorOpen(false); setPreview(null); }} disabled={busy}>{t('pos.cancel')}</button>
              <button className="btn" onClick={pickPhoto} disabled={busy}>{t('pos.choose_another')}</button>
              <button className="btn primary" onClick={save} disabled={busy}>{busy ? t('pos.saving_2') : t('pos.save_photo')}</button>
            </div>
          </div>
        </div>
      )}

      {securityModalOpen && <POSSecuritySettingsModal onClose={() => setSecurityModalOpen(false)} />}
      {screenCheckOpen && <ScreenCheckDialog onClose={() => setScreenCheckOpen(false)} />}
    </div>
  );
}