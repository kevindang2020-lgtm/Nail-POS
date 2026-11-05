// TechProfileScreen.tsx — the tech's PORTABLE public profile (tech-profile spec set): avatar + portfolio uploads
// (server validates magic bytes + size), bio/title/specialties/languages, validated external links, public &
// marketplace toggles, completion meter, ratings summary with reviewer privacy, and "Connect to New Salon".
import { useCallback, useEffect, useRef, useState } from 'react';
import { techApi, type TechPhoto, type TechProfile, type TechRatings, type TechBeforeAfter, type TechAnalytics } from '../api/techApi';
import { useTechNav } from '../shell/nav';

const LINK_KEYS: [string, string][] = [['linkme', 'LinkMe'], ['linktree', 'Linktree'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'], ['youtube', 'YouTube'], ['pinterest', 'Pinterest'], ['website', 'Website']];
const SHAPES = ['Round', 'Square', 'Squoval', 'Oval', 'Almond', 'Coffin', 'Ballerina', 'Stiletto', 'Lipstick', 'Flare', 'Custom'];
const LENGTHS = ['Extra Short', 'Short', 'Medium', 'Long', 'Extra Long'];
const COMPLEXITIES = ['Simple', 'Moderate', 'Detailed', 'Intricate'];
const CONSENT_USES: [string, string][] = [['portfolio', 'Portfolio'], ['nailshowcase', 'Showcase'], ['salon_marketing', 'Salon mktg'], ['social_marketing', 'Social']];
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);

interface PhotoDraft {
  caption: string;
  nailShape: string;
  nailLength: string;
  complexity: string;
  designStyle: string;
  colorName: string;
  brand: string;
  approvedUses: string[];
  isFeatured: boolean;
  hasChanges?: boolean;
}

/** Client-side image compression to prevent memory exhaustion / app crash on large mobile camera photos */
async function compressImage(file: File, maxDim = 2048, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || (file.size <= 1.5 * 1024 * 1024 && (file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'image/png'))) {
    return file;
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          const name = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export function TechProfileScreen() {
  const { back } = useTechNav();
  const [p, setP] = useState<TechProfile | null>(null);
  const [photos, setPhotos] = useState<TechPhoto[]>([]);
  const [photoDrafts, setPhotoDrafts] = useState<Record<string, PhotoDraft>>({});
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoToDelete, setPhotoToDelete] = useState<TechPhoto | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState(false);
  const [ratings, setRatings] = useState<TechRatings | null>(null);
  const [insights, setInsights] = useState<TechAnalytics | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [baList, setBaList] = useState<TechBeforeAfter[]>([]);
  const [baBefore, setBaBefore] = useState<File | null>(null);
  const [baAfter, setBaAfter] = useState<File | null>(null);
  const [baService, setBaService] = useState('');
  const [baNotes, setBaNotes] = useState('');
  const [baConsent, setBaConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // edit fields
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [years, setYears] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [languages, setLanguages] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [linkVis, setLinkVis] = useState<Record<string, string>>({});

  const [salonCode, setSalonCode] = useState('');
  const [moveMsg, setMoveMsg] = useState('');

  const avatarRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);
  const photosRef = useRef<HTMLInputElement | null>(null);

  const hydrate = useCallback((prof: TechProfile) => {
    setP(prof);
    setDisplayName(prof.displayName); setTitle(prof.title ?? ''); setBio(prof.bio ?? '');
    setYears(prof.yearsExperience != null ? String(prof.yearsExperience) : '');
    setSpecialties(prof.specialties.join(', ')); setLanguages(prof.languages.join(', '));
    setLinks({ ...prof.profileLinks });
    setLinkVis({ ...(prof.profileLinkVisibility || {}) });
  }, []);

  const load = useCallback(() => {
    Promise.all([techApi.profile(), techApi.myPhotos(), techApi.myRatings(), techApi.listBeforeAfter().catch(() => [] as TechBeforeAfter[]), techApi.analytics().catch(() => null)])
      .then(([prof, ph, rt, ba, an]) => { hydrate(prof); setPhotos(ph); setRatings(rt); setBaList(ba); setInsights(an); setError(null); })
      .catch((e: any) => setError(e?.message || 'Could not load your profile.'));
  }, [hydrate]);
  useEffect(() => {
    load();
    const onFocus = () => {
      techApi.myPhotos().then((ph) => setPhotos(ph)).catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // Sync photo drafts when photos load from server without overriding unsaved edits
  useEffect(() => {
    setPhotoDrafts((prev) => {
      const next = { ...prev };
      photos.forEach((ph) => {
        if (!next[ph.photoId] || !next[ph.photoId].hasChanges) {
          next[ph.photoId] = {
            caption: ph.caption ?? '',
            nailShape: ph.nailShape ?? '',
            nailLength: ph.nailLength ?? '',
            complexity: ph.complexity ?? '',
            designStyle: ph.designStyle ?? '',
            colorName: ph.colorName ?? '',
            brand: ph.brand ?? '',
            approvedUses: ph.consent?.approvedUses ?? [],
            isFeatured: !!ph.isFeatured,
            hasChanges: false,
          };
        }
      });
      return next;
    });
  }, [photos]);

  const act = async (fn: () => Promise<unknown>, okNote?: string) => {
    setBusy(true); setNote(null); setError(null);
    try { await fn(); load(); if (okNote) setNote(okNote); }
    catch (e: any) { setError(e?.message || 'That didn’t work.'); }
    finally { setBusy(false); }
  };

  const save = () => act(async () => hydrate(await techApi.updateProfile({
    displayName, title, bio, yearsExperience: years === '' ? null : Number(years),
    specialties: specialties.split(',').map((x) => x.trim()).filter(Boolean),
    languages: languages.split(',').map((x) => x.trim()).filter(Boolean),
    profileLinks: links,
    profileLinkVisibility: linkVis,
  })), 'Profile saved.');

  const toggle = (key: 'isPublic' | 'marketplaceDiscoveryEnabled' | 'isBookable' | 'acceptsMessages', v: boolean) =>
    act(async () => hydrate(await techApi.updateProfile({ [key]: v })));

  // Update photo draft in local state without making network requests
  const updateDraft = (photoId: string, patch: Partial<PhotoDraft>) => {
    setPhotoDrafts((prev) => {
      const current = prev[photoId] || {
        caption: '', nailShape: '', nailLength: '', complexity: '',
        designStyle: '', colorName: '', brand: '', approvedUses: [], isFeatured: false,
      };
      return {
        ...prev,
        [photoId]: {
          ...current,
          ...patch,
          hasChanges: true,
        },
      };
    });
  };

  const toggleDraftUse = (photoId: string, useKey: string) => {
    const curUses = photoDrafts[photoId]?.approvedUses ?? [];
    const nextUses = curUses.includes(useKey) ? curUses.filter((u) => u !== useKey) : [...curUses, useKey];
    updateDraft(photoId, { approvedUses: nextUses });
  };

  // Save photo metadata & consent in one atomic action
  const savePhotoDetails = async (ph: TechPhoto) => {
    const draft = photoDrafts[ph.photoId];
    if (!draft) return;
    setSavingPhotoId(ph.photoId);
    setError(null);
    setNote(null);
    try {
      await techApi.updatePhoto(ph.photoId, {
        caption: draft.caption,
        nailShape: draft.nailShape || null,
        nailLength: draft.nailLength || null,
        complexity: draft.complexity || null,
        designStyle: draft.designStyle,
        colorName: draft.colorName,
        brand: draft.brand,
        isFeatured: draft.isFeatured,
        isPublic: true,
      });

      const consentUses = draft.approvedUses && draft.approvedUses.length > 0 ? draft.approvedUses : ['portfolio'];
      const consentRes = await techApi.setPhotoConsent(ph.photoId, {
        approvedUses: consentUses,
      });

      setPhotos((prev) =>
        prev.map((p) =>
          p.photoId === ph.photoId
            ? {
                ...p,
                caption: draft.caption,
                nailShape: draft.nailShape || null,
                nailLength: draft.nailLength || null,
                complexity: draft.complexity || null,
                designStyle: draft.designStyle,
                colorName: draft.colorName,
                brand: draft.brand,
                isFeatured: draft.isFeatured,
                consent: consentRes?.consent ?? { approvedUses: draft.approvedUses, revoked: false },
              }
            : p
        )
      );

      setPhotoDrafts((prev) => ({
        ...prev,
        [ph.photoId]: { ...draft, hasChanges: false },
      }));

      setNote('Photo details and customer consent saved.');
    } catch (e: any) {
      setError(e?.message || 'Could not save photo details.');
    } finally {
      setSavingPhotoId(null);
    }
  };

  const withdrawPhotoConsent = async (ph: TechPhoto) => {
    setSavingPhotoId(ph.photoId);
    setError(null);
    try {
      const res = await techApi.withdrawPhotoConsent(ph.photoId);
      setPhotos((prev) =>
        prev.map((p) =>
          p.photoId === ph.photoId
            ? { ...p, consent: res?.consent ?? { approvedUses: [], revoked: true } }
            : p
        )
      );
      setPhotoDrafts((prev) => ({
        ...prev,
        [ph.photoId]: { ...(prev[ph.photoId] || {}), approvedUses: [], hasChanges: false } as PhotoDraft,
      }));
      setNote('Consent withdrawn. Photo will not appear in public showcase.');
    } catch (e: any) {
      setError(e?.message || 'Could not withdraw consent.');
    } finally {
      setSavingPhotoId(null);
    }
  };

  const toggleFeatured = async (ph: TechPhoto) => {
    const curDraft = photoDrafts[ph.photoId];
    const nextVal = curDraft ? !curDraft.isFeatured : !ph.isFeatured;
    updateDraft(ph.photoId, { isFeatured: nextVal });
    setPhotos((prev) => prev.map((p) => (p.photoId === ph.photoId ? { ...p, isFeatured: nextVal } : p)));
    try {
      await techApi.updatePhoto(ph.photoId, { isFeatured: nextVal });
    } catch { /* ignore */ }
  };

  const confirmDeletePhoto = async () => {
    if (!photoToDelete) return;
    const target = photoToDelete;
    setDeletingPhoto(true);
    setError(null);
    try {
      await techApi.deletePhoto(target.photoId);
      setPhotos((prev) => prev.filter((p) => p.photoId !== target.photoId));
      setPhotoDrafts((prev) => {
        const next = { ...prev };
        delete next[target.photoId];
        return next;
      });
      setPhotoToDelete(null);
      setNote('Photo removed from your portfolio.');
    } catch (e: any) {
      setError(e?.message || 'Could not delete photo.');
    } finally {
      setDeletingPhoto(false);
    }
  };

  const movePhoto = async (dir: -1 | 1, idx: number) => {
    const j = idx + dir;
    if (j < 0 || j >= photos.length) return;
    const reordered = [...photos];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(j, 0, moved);
    setPhotos(reordered);
    try {
      await techApi.reorderPhotos(reordered.map((x) => x.photoId));
    } catch {
      setPhotos(photos);
    }
  };

  const addBeforeAfter = () => {
    if (!baBefore || !baAfter) { setNote('Add both a before and an after photo.'); return; }
    act(async () => { await techApi.createBeforeAfter(baBefore, baAfter, { servicePerformed: baService, designNotes: baNotes, customerConsent: baConsent }); setBaBefore(null); setBaAfter(null); setBaService(''); setBaNotes(''); setBaConsent(false); }, 'Before/after set added.');
  };
  const publishBa = (ba: TechBeforeAfter) => act(() => techApi.updateBeforeAfter(ba.setId, { isPublic: !ba.isPublic }), ba.isPublic ? 'Set hidden.' : 'Set published.');
  const toggleBaConsent = (ba: TechBeforeAfter) => act(() => techApi.updateBeforeAfter(ba.setId, { customerConsent: !ba.customerConsent }), 'Consent updated.');
  const deleteBa = (ba: TechBeforeAfter) => act(() => techApi.deleteBeforeAfter(ba.setId), 'Set removed.');

  const onAvatar = (f: File | undefined) => { if (f) act(async () => hydrate(await techApi.uploadAvatar(f)), 'Avatar updated.'); };
  const onCover = (f: File | undefined) => { if (f) act(async () => hydrate(await techApi.uploadCover(f)), 'Cover updated.'); };

  const onPhotos = async (fl: FileList | null) => {
    const rawFiles = Array.from(fl ?? []);
    if (!rawFiles.length) return;

    setUploadingPhotos(true);
    setError(null);
    try {
      const processed: File[] = [];
      for (const f of rawFiles) {
        if (!f.type.startsWith('image/')) {
          throw new Error(`"${f.name}" is not a valid image file.`);
        }
        const compressed = await compressImage(f);
        processed.push(compressed);
      }
      // Batch uploads in groups of 10 if necessary (backend maximum per single request)
      for (let i = 0; i < processed.length; i += 10) {
        const batch = processed.slice(i, i + 10);
        const res = await techApi.addPhotos(batch);
        if (res?.photos) {
          for (const ph of res.photos) {
            await techApi.updatePhoto(ph.photoId, { isPublic: true }).catch(() => {});
            await techApi.setPhotoConsent(ph.photoId, { approvedUses: ['portfolio'] }).catch(() => {});
          }
        }
      }
      const fresh = await techApi.myPhotos();
      setPhotos(fresh);
      setNote(`${processed.length} photo${processed.length > 1 ? 's' : ''} added to your portfolio.`);
    } catch (e: any) {
      setError(e?.message || 'Failed to upload photo(s). Please try again.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const stars = (n: number | null) => n == null ? '—' : `${n.toFixed(2)} ★`;
  const pct = (k: string) => { const total = ratings ? Object.values(ratings.breakdown).reduce((a, b) => a + b, 0) : 0; return total ? Math.round(((ratings!.breakdown[k] ?? 0) / total) * 100) : 0; };

  const input = { width: '100%', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--tech-border)', fontSize: 13.5, background: '#fff' } as const;
  const label = { fontSize: 11.5, fontWeight: 700 as const, opacity: 0.65, marginBottom: 4, display: 'block' };
  const taxSel = { ...input, padding: '7px 9px', fontSize: 12, flex: '1 1 30%', minWidth: 90, height: 36 } as const;
  const taxIn = { ...input, padding: '7px 9px', fontSize: 12, flex: '1 1 30%', minWidth: 90, height: 36 } as const;

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" onClick={back} aria-label="Back" style={{ minWidth: 44 }}><Back /></button>
        <h1 className="t-title" style={{ margin: 0, fontSize: 19 }}>My Public Profile</h1>
      </div>
      <div className="tech-main-2">
        {error ? <div className="tech-card" style={{ padding: 12, color: 'var(--tech-danger, #B3261E)', marginBottom: 10 }} role="alert">{error}</div> : null}
      {note ? <div className="tech-card" style={{ padding: 12, marginBottom: 10 }} role="status">{note}</div> : null}
      {!p ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="tech-card" style={{ padding: 0, height: 180, overflow: 'hidden' }}>
            <div className="tech-skel" style={{ width: '100%', height: '100%' }} />
          </div>
          <div className="tech-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="tech-skel" style={{ width: 64, height: 64, borderRadius: 99, flex: '0 0 auto' }} />
            <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="tech-skel" style={{ width: 120, height: 20 }} />
              <div className="tech-skel" style={{ width: 180, height: 14 }} />
              <div className="tech-skel" style={{ width: '100%', height: 6, borderRadius: 99, marginTop: 4 }} />
              <div className="tech-skel" style={{ width: 100, height: 12 }} />
            </div>
          </div>
          <div className="tech-grid cols-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="tech-metric">
                <div className="mv"><div className="tech-skel" style={{ width: 24, height: 20, margin: '0 auto' }} /></div>
                <div className="ml"><div className="tech-skel" style={{ width: 40, height: 12, margin: '0 auto' }} /></div>
              </div>
            ))}
          </div>
          <div className="tech-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div className="tech-skel" style={{ width: 100, height: 16 }} />
            <div className="tech-skel" style={{ width: '100%', height: 40, borderRadius: 10 }} />
            <div className="tech-skel" style={{ width: '100%', height: 76, borderRadius: 10 }} />
            <div className="tech-skel" style={{ width: '100%', height: 40, borderRadius: 10 }} />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Cover banner (portable, technician-owned) */}
          <div
            className="tech-card"
            style={{
              padding: 0,
              overflow: 'hidden',
              position: 'relative',
              borderRadius: 16,
              background: p.coverUrl ? '#12100E' : 'linear-gradient(135deg, rgba(201, 150, 46, 0.1) 0%, rgba(138, 90, 158, 0.08) 100%)',
              border: p.coverUrl ? '1px solid var(--tech-border)' : '1.5px dashed rgba(201, 150, 46, 0.35)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            {p.coverUrl ? (
              <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D0B0A' }}>
                <img
                  src={p.coverUrl}
                  alt="Profile Cover"
                  style={{
                    width: '100%',
                    maxHeight: 280,
                    minHeight: 140,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />

                {/* Subtle gradient overlay at the bottom for floating buttons contrast */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 100%)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Floating Glassmorphic Action Buttons */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    right: 12,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    zIndex: 2,
                  }}
                >
                  <button
                    type="button"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      background: 'rgba(20, 16, 12, 0.82)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      color: '#fff',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      borderRadius: 99,
                      padding: '0 14px',
                      fontSize: 12,
                      fontWeight: 700,
                      height: 34,
                      width: 'auto',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                      lineHeight: 1,
                    }}
                    onClick={() => coverRef.current?.click()}
                    aria-label="Change cover image"
                  >
                    <span>📷</span>
                    <span>Change Cover</span>
                  </button>

                  <button
                    type="button"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(185, 28, 28, 0.88)',
                      backdropFilter: 'blur(10px)',
                      WebkitBackdropFilter: 'blur(10px)',
                      color: '#fff',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      borderRadius: 99,
                      padding: '0 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      height: 34,
                      width: 'auto',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                      lineHeight: 1,
                    }}
                    onClick={() => act(async () => hydrate(await techApi.removeCover()), 'Cover removed.')}
                    aria-label="Remove cover"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                aria-label="Change cover image"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  minHeight: 140,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'transparent',
                  padding: '24px 16px',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'rgba(201, 150, 46, 0.15)',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 20,
                  }}
                >
                  📷
                </div>
                <div style={{ color: 'var(--tech-text, #1E1B18)', fontWeight: 700, fontSize: 13.5 }}>
                  Add a Cover Image
                </div>
                <div className="tech-muted" style={{ fontSize: 11.5 }}>
                  Header banner for your public portfolio
                </div>
              </button>
            )}

            <input
              ref={coverRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              aria-label="Cover file"
              onChange={(e) => {
                onCover(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {/* Verification */}
          <div className="tech-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            {p.verificationStatus === 'verified' ? (
              <div style={{ fontSize: 13, fontWeight: 800, color: '#2E7D32' }}>✔ Verified technician</div>
            ) : p.verificationStatus === 'pending' ? (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#8A6D1B' }}>Verification pending review</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5 }} className="tech-muted">Get a verified badge on your public profile.</div>
                <button className="tech-btn ghost" style={{ marginLeft: 'auto', fontSize: 12 }} disabled={busy}
                  onClick={() => act(async () => { await techApi.requestVerification(); hydrate(await techApi.profile()); }, 'Verification requested.')}>Request verification</button>
              </>
            )}
          </div>

          {/* Hero + completion */}
          <div className="tech-card" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <button onClick={() => avatarRef.current?.click()} aria-label="Change avatar" style={{ width: 64, height: 64, borderRadius: 99, border: '2px solid #C9962E', background: '#F4E9D8', overflow: 'hidden', cursor: 'pointer', flex: '0 0 auto', display: 'grid', placeItems: 'center', fontSize: 22 }}>
              {p.avatarUrl ? <img src={p.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📷'}
            </button>
            <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} aria-label="Avatar file" onChange={(e) => onAvatar(e.target.files?.[0])} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{p.displayName}</div>
              <div className="tech-muted" style={{ fontSize: 12 }}>{stars(p.overallRating)} · {p.ratingCount} reviews · {photos.length} photos</div>
              <div style={{ marginTop: 6, height: 6, borderRadius: 99, background: '#EFE6D6', overflow: 'hidden' }} aria-label={`Profile ${p.completionPercent}% complete`}>
                <div style={{ width: `${p.completionPercent}%`, height: '100%', background: 'linear-gradient(90deg,#C9962E,#A96F22)' }} />
              </div>
              <div className="tech-muted" style={{ fontSize: 11, marginTop: 3 }}>Profile {p.completionPercent}% complete
                <button className="tech-btn ghost" style={{ fontSize: 10.5, padding: '2px 8px', marginLeft: 8 }}
                  onClick={async () => {
                    try {
                      await techApi.publicPreview();
                      const custBase = typeof window !== 'undefined' && window.location.hostname === 'localhost' ? `${window.location.protocol}//${window.location.hostname}:5176` : '';
                      window.open(`${custBase}/techs/${p.publicSlug}`, '_blank');
                    } catch (e: any) { setError(e?.message || 'Preview failed.'); }
                  }}>Preview</button>
              </div>
            </div>
          </div>

          {/* At-a-glance stats (server-truth) */}
          <div className="tech-grid cols-4">
            <div className="tech-metric"><div className="mv">{p.overallRating != null ? p.overallRating.toFixed(1) : '—'}</div><div className="ml">Rating</div></div>
            <div className="tech-metric"><div className="mv">{p.ratingCount}</div><div className="ml">Reviews</div></div>
            <div className="tech-metric"><div className="mv">{p.verifiedCompletedServicesCount}</div><div className="ml">Services</div></div>
            <div className="tech-metric"><div className="mv">{p.yearsExperience != null ? p.yearsExperience : '—'}</div><div className="ml">Years</div></div>
          </div>

          {/* Visibility toggles */}
          {/* <div className="tech-card" style={{ padding: 14 }}>
            <div className="tech-label" style={{ marginBottom: 8 }}>Visibility</div>
            {([['isPublic', 'Public profile', p.isPublic], ['marketplaceDiscoveryEnabled', 'Show me in “Find Techs Near Me”', p.marketplaceDiscoveryEnabled], ['isBookable', 'Customers can book me', p.isBookable], ['acceptsMessages', 'Customers can message me', p.acceptsMessages !== false]] as const).map(([k, lbl, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--tech-border)' }}>
                <span style={{ fontSize: 13 }}>{lbl}</span>
                <button className="tech-btn ghost" disabled={busy} aria-pressed={v} onClick={() => toggle(k, !v)} style={{ fontSize: 12, fontWeight: 700, color: v ? '#2E7D32' : undefined }}>{v ? 'On' : 'Off'}</button>
              </div>
            ))}
          </div> */}
          <div className="tech-card visibility-card">
            <div className="visibility-header">
              <div>
                <div className="visibility-title">Visibility</div>
                <div className="visibility-subtitle">
                  Control how customers can discover and interact with you
                </div>
              </div>
            </div>

            <div className="visibility-list">
              {([
                ['isPublic', 'Public profile', p.isPublic],
                ['marketplaceDiscoveryEnabled', 'Show me in “Find Techs Near Me”', p.marketplaceDiscoveryEnabled],
                ['isBookable', 'Customers can book me', p.isBookable],
                ['acceptsMessages', 'Customers can message me', p.acceptsMessages !== false],
              ] as const).map(([k, lbl, v]) => (
                <div className="visibility-row" key={k}>
                  <span className="visibility-label">
                    {lbl}
                  </span>

                  <button
                    type="button"
                    className={`visibility-toggle ${v ? 'active' : ''}`}
                    disabled={busy}
                    aria-label={`${lbl}: ${v ? 'On' : 'Off'}`}
                    aria-pressed={v}
                    onClick={() => toggle(k, !v)}
                  >
                    <span className="visibility-toggle-thumb" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Edit form */}
          <div className="tech-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div className="tech-label">About me</div>
            <div><span style={label}>Display name</span><input style={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display name" /></div>
            <div><span style={label}>Title</span><input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Nail Artist" aria-label="Title" /></div>
            <div><span style={label}>Bio</span><textarea style={{ ...input, minHeight: 76, resize: 'vertical' }} value={bio} onChange={(e) => setBio(e.target.value)} aria-label="Bio" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><span style={label}>Years experience</span><input style={input} inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value.replace(/[^0-9]/g, ''))} aria-label="Years of experience" /></div>
              <div><span style={label}>Languages (comma-separated)</span><input style={input} value={languages} onChange={(e) => setLanguages(e.target.value)} aria-label="Languages" /></div>
            </div>
            <div><span style={label}>Specialties (comma-separated)</span><input style={input} value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="Gel X, Chrome, 3D Design" aria-label="Specialties" /></div>
            <div className="tech-label" style={{ marginTop: 4 }}>External links <span className="tech-muted" style={{ fontWeight: 400 }}>(http/https only — unsafe links are dropped)</span></div>
            {LINK_KEYS.map(([k, lbl]) => (
              <div key={k}>
                <span style={label}>{lbl}</span>
                <input style={input} value={links[k] ?? ''} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} placeholder={`https://…`} aria-label={`${lbl} URL`} />
                {(links[k] ?? '').trim() !== '' && (
                  <select style={{ ...input, marginTop: 6 }} value={linkVis[k] ?? 'public'} onChange={(e) => setLinkVis({ ...linkVis, [k]: e.target.value })} aria-label={`${lbl} visibility`}>
                    <option value="public">Public — anyone can see</option>
                    <option value="booked_only">Booked customers only</option>
                    <option value="hidden">Hidden</option>
                  </select>
                )}
              </div>
            ))}
            <button className="tech-btn gold" style={{ marginTop: 14 }} disabled={busy} onClick={save}>{busy ? '…' : 'Save Profile'}</button>
          </div>

          {/* Portfolio manager */}
          <div className="tech-card " style={{ padding: 16 }}>
            <div className='!gap-2' style={{ display: 'flex',flexDirection:'column', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="tech-label" style={{ margin: 0, fontSize: 13.5, fontWeight: 800 }}>Nail design portfolio</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '2px 9px',
                      borderRadius: 999,
                      background: 'rgba(201, 150, 46, 0.15)',
                      color: '#996C18',
                      lineHeight: '18px',
                    }}
                  >
                    {photos.length}
                  </span>
                </div>
                <div className="tech-muted " style={{ fontSize: 11.5, marginTop: 3,marginBottom:8, lineHeight: 1.4 }}>
                  Add photos of your work. Edit details and consent, then click Save.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                {p.publicSlug ? (
                  <button
                    type="button"
                    className="tech-btn ghost"
                    style={{
                      width: 'auto',
                      height: 34,
                      fontSize: 12,
                      fontWeight: 700,
                      padding: '0 10px',
                      borderRadius: 8,
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fff',
                      color: 'var(--tech-primary-dark, #5C4314)',
                      border: '1px solid #DBCAB0',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      const custBase = typeof window !== 'undefined' && window.location.hostname === 'localhost' ? `${window.location.protocol}//${window.location.hostname}:5176` : '';
                      window.open(`${custBase}/techs/${p.publicSlug}`, '_blank');
                    }}
                  >
                    View Public Album ↗
                  </button>
                ) : null}
                <button
                  type="button"
                  className="tech-btn ghost"
                  style={{
                    width: 'auto',
                    height: 34,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '0 12px',
                    borderRadius: 8,
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--tech-primary-light, #FBF3E4)',
                    color: 'var(--tech-primary-dark, #5C4314)',
                    border: '1px solid #DBCAB0',
                    cursor: busy || uploadingPhotos ? 'default' : 'pointer',
                    opacity: 1,
                  }}
                  disabled={busy || uploadingPhotos}
                  onClick={() => photosRef.current?.click()}
                >
                  {uploadingPhotos ? 'Uploading…' : '+ Add Photos'}
                </button>
              </div>
              <input ref={photosRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }} aria-label="Portfolio files" onChange={(e) => { onPhotos(e.target.files); e.target.value = ''; }} />
            </div>

            {uploadingPhotos && (
              <div style={{ padding: '10px 14px', background: 'rgba(201, 150, 46, 0.08)', borderRadius: 10, border: '1px solid rgba(201, 150, 46, 0.25)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#996C18', fontWeight: 600 }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
                Optimizing &amp; uploading photo(s)…
              </div>
            )}

            {photos.length === 0 ? (
              <div className="tech-muted" style={{ fontSize: 12.5, padding: '16px 8px', textAlign: 'center' }}>
                Upload your best nail designs — profiles with 3+ photos stand out to customers.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {photos.map((ph, i) => {
                  const draft = photoDrafts[ph.photoId] || {
                    caption: ph.caption ?? '',
                    nailShape: ph.nailShape ?? '',
                    nailLength: ph.nailLength ?? '',
                    complexity: ph.complexity ?? '',
                    designStyle: ph.designStyle ?? '',
                    colorName: ph.colorName ?? '',
                    brand: ph.brand ?? '',
                    approvedUses: ph.consent?.approvedUses?.length ? ph.consent.approvedUses : ['portfolio'],
                    isFeatured: !!ph.isFeatured,
                    hasChanges: false,
                  };
                  const isSaving = savingPhotoId === ph.photoId;

                  return (
                    <div
                      key={ph.photoId}
                      style={{
                        border: draft.hasChanges ? '1.5px solid #D97706' : '1px solid var(--tech-border)',
                        borderRadius: 14,
                        padding: 12,
                        background: draft.hasChanges ? 'rgba(217, 119, 6, 0.02)' : '#fff',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
                        transition: 'border-color .15s ease',
                      }}
                    >
                      {/* Top Header: Photo preview + Caption + Controls */}
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ position: 'relative', flex: '0 0 auto' }}>
                          <img
                            src={ph.thumbnailUrl ?? ph.imageUrl}
                            alt={draft.caption || 'Nail design'}
                            style={{ width: 68, height: 68, borderRadius: 10, objectFit: 'cover', background: '#F4E9D8', border: '1px solid var(--tech-border)' }}
                          />
                          {draft.isFeatured && (
                            <span style={{ position: 'absolute', top: -4, right: -4, background: '#C9962E', color: '#fff', fontSize: 10, padding: '2px 4px', borderRadius: 6, fontWeight: 800 }}>
                              ★
                            </span>
                          )}
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <input
                            style={{ ...input, padding: '7px 10px', fontSize: 13, fontWeight: 500 }}
                            value={draft.caption}
                            placeholder="Add a caption for this design…"
                            aria-label="Photo caption"
                            onChange={(e) => updateDraft(ph.photoId, { caption: e.target.value })}
                          />

                          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="tech-btn ghost"
                              style={{
                                width: 'auto',
                                height: 32,
                                padding: '0 10px',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: draft.isFeatured ? '#FEF3C7' : '#F9FAFB',
                                color: draft.isFeatured ? '#92400E' : '#4B5563',
                                border: draft.isFeatured ? '1px solid #FCD34D' : '1px solid #E5E7EB',
                                cursor: 'pointer',
                              }}
                              onClick={() => toggleFeatured(ph)}
                            >
                              {draft.isFeatured ? '★ Featured' : '☆ Feature'}
                            </button>
                            <button
                              type="button"
                              className="tech-btn ghost"
                              style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#F9FAFB',
                                color: '#4B5563',
                                border: '1px solid #E5E7EB',
                                cursor: i === 0 ? 'default' : 'pointer',
                                opacity: i === 0 ? 0.35 : 1,
                              }}
                              disabled={i === 0}
                              onClick={() => movePhoto(-1, i)}
                              aria-label="Move up"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="tech-btn ghost"
                              style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: '#F9FAFB',
                                color: '#4B5563',
                                border: '1px solid #E5E7EB',
                                cursor: i === photos.length - 1 ? 'default' : 'pointer',
                                opacity: i === photos.length - 1 ? 0.35 : 1,
                              }}
                              disabled={i === photos.length - 1}
                              onClick={() => movePhoto(1, i)}
                              aria-label="Move down"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="tech-btn ghost"
                              style={{
                                width: 'auto',
                                height: 32,
                                padding: '0 10px',
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: '#FEF2F2',
                                color: '#DC2626',
                                border: '1px solid #FECACA',
                                marginLeft: 'auto',
                                cursor: 'pointer',
                              }}
                              onClick={() => setPhotoToDelete(ph)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Taxonomy Attributes */}
                      <div style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <select
                            style={taxSel}
                            value={draft.nailShape}
                            aria-label="Nail shape"
                            onChange={(e) => updateDraft(ph.photoId, { nailShape: e.target.value })}
                          >
                            <option value="">Shape…</option>
                            {SHAPES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <select
                            style={taxSel}
                            value={draft.nailLength}
                            aria-label="Nail length"
                            onChange={(e) => updateDraft(ph.photoId, { nailLength: e.target.value })}
                          >
                            <option value="">Length…</option>
                            {LENGTHS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <select
                            style={taxSel}
                            value={draft.complexity}
                            aria-label="Complexity"
                            onChange={(e) => updateDraft(ph.photoId, { complexity: e.target.value })}
                          >
                            <option value="">Detail…</option>
                            {COMPLEXITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>

                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <input
                            style={taxIn}
                            value={draft.designStyle}
                            placeholder="Style (e.g. Chrome)"
                            aria-label="Design style"
                            onChange={(e) => updateDraft(ph.photoId, { designStyle: e.target.value })}
                          />
                          <input
                            style={taxIn}
                            value={draft.colorName}
                            placeholder="Color (e.g. Nude)"
                            aria-label="Color name"
                            onChange={(e) => updateDraft(ph.photoId, { colorName: e.target.value })}
                          />
                          <input
                            style={taxIn}
                            value={draft.brand}
                            placeholder="Brand (e.g. OPI)"
                            aria-label="Brand"
                            onChange={(e) => updateDraft(ph.photoId, { brand: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* Customer consent section */}
                      <div style={{ marginTop: 10, background: 'rgba(201, 150, 46, 0.04)', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(201, 150, 46, 0.15)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tech-text)' }}>
                            Customer consent (for client photos)
                          </div>
                          {draft.hasChanges ? (
                            <span style={{ fontSize: 11, color: '#D97706', fontWeight: 700 }}>
                              ● Unsaved changes
                            </span>
                          ) : ph.consent?.revoked ? (
                            <span style={{ fontSize: 11, color: '#B3261E', fontWeight: 600 }}>
                              ⚠ Withdrawn
                            </span>
                          ) : ph.consent ? (
                            <span style={{ fontSize: 11, color: '#15803D', fontWeight: 700 }}>
                              ✓ On file
                            </span>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                          {CONSENT_USES.map(([k, lbl]) => (
                            <label key={k} style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={draft.approvedUses.includes(k)}
                                onChange={() => toggleDraftUse(ph.photoId, k)}
                                aria-label={`${lbl} consent`}
                              />
                              {lbl}
                            </label>
                          ))}
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="tech-btn"
                            style={{
                              width: 'auto',
                              height: 32,
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '0 14px',
                              borderRadius: 8,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: draft.hasChanges ? 'linear-gradient(180deg, #D9A94D, #C78A2F)' : 'var(--tech-surface, #fff)',
                              color: draft.hasChanges ? '#fff' : 'var(--tech-text, #2D2319)',
                              border: draft.hasChanges ? 'none' : '1px solid var(--tech-border, #E6DAC8)',
                              boxShadow: draft.hasChanges ? '0 1px 3px rgba(199, 138, 47, 0.3)' : 'none',
                              cursor: isSaving ? 'default' : 'pointer',
                            }}
                            disabled={isSaving}
                            onClick={() => savePhotoDetails(ph)}
                          >
                            {isSaving ? 'Saving…' : draft.hasChanges ? 'Save Changes' : 'Save Consent & Details'}
                          </button>

                          {ph.consent && !ph.consent.revoked && (
                            <button
                              type="button"
                              className="tech-btn ghost"
                              style={{
                                width: 'auto',
                                height: 32,
                                fontSize: 11.5,
                                fontWeight: 600,
                                color: 'var(--tech-danger, #B3261E)',
                                padding: '0 10px',
                                borderRadius: 8,
                                background: '#FEF2F2',
                                border: '1px solid #FECACA',
                                cursor: isSaving ? 'default' : 'pointer',
                              }}
                              disabled={isSaving}
                              onClick={() => withdrawPhotoConsent(ph)}
                            >
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Before & After sets */}
          <div className="tech-card" style={{ padding: 14 }}>
            <div className="tech-label" style={{ marginBottom: 8 }}>Before &amp; After</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.7 }}>Before<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Before image" style={{ display: 'block', fontSize: 11, marginTop: 3 }} onChange={(e) => setBaBefore(e.target.files?.[0] ?? null)} /></label>
              <label style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.7 }}>After<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="After image" style={{ display: 'block', fontSize: 11, marginTop: 3 }} onChange={(e) => setBaAfter(e.target.files?.[0] ?? null)} /></label>
            </div>
            <input style={{ ...input, marginTop: 8 }} value={baService} onChange={(e) => setBaService(e.target.value)} placeholder="Service performed (e.g. Acrylic full set)" aria-label="Before/after service" />
            <input style={{ ...input, marginTop: 6 }} value={baNotes} onChange={(e) => setBaNotes(e.target.value)} placeholder="Design notes (optional)" aria-label="Before/after notes" />
            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, marginTop: 6 }}>
              <input type="checkbox" checked={baConsent} onChange={(e) => setBaConsent(e.target.checked)} aria-label="Before/after customer consent" />Customer consented to publish
            </label>
            <button className="tech-btn" style={{ marginTop: 8, fontSize: 13 }} disabled={busy} onClick={addBeforeAfter}>Add before/after set</button>

            {baList.length ? (
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {baList.map((ba) => (
                  <div key={ba.setId} style={{ border: '1px solid var(--tech-border)', borderRadius: 12, padding: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <img src={ba.beforeThumbnailUrl ?? ba.beforeImageUrl} alt="Before" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, background: '#F4E9D8' }} />
                        <div className="tech-muted" style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>BEFORE</div>
                      </div>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <img src={ba.afterThumbnailUrl ?? ba.afterImageUrl} alt="After" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8, background: '#F4E9D8' }} />
                        <div className="tech-muted" style={{ fontSize: 10, fontWeight: 700, marginTop: 2 }}>AFTER</div>
                      </div>
                    </div>
                    {ba.servicePerformed ? <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 5 }}>{ba.servicePerformed}</div> : null}
                    {ba.designNotes ? <div className="tech-muted" style={{ fontSize: 11.5 }}>{ba.designNotes}</div> : null}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <input type="checkbox" checked={ba.customerConsent} onChange={() => toggleBaConsent(ba)} aria-label="Consent on file" />Consent
                      </label>
                      <button className="tech-btn ghost" style={{ fontSize: 11 }} disabled={busy} onClick={() => publishBa(ba)}>{ba.isPublic ? 'Unpublish' : 'Publish'}</button>
                      <button className="tech-btn ghost" style={{ fontSize: 11, color: 'var(--tech-danger, #B3261E)' }} disabled={busy} onClick={() => deleteBa(ba)}>Delete</button>
                      <span className="tech-muted" style={{ fontSize: 10.5 }}>{ba.isPublic ? '● Public' : '○ Hidden'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="tech-muted" style={{ fontSize: 12, marginTop: 8 }}>Show off a transformation — upload a before and after of the same service.</div>}
          </div>

          {/* Insights — real profile analytics over the last 30 days */}
          <div className="tech-card" style={{ padding: 14 }}>
            <div className="tech-label" style={{ marginBottom: 8 }}>Insights · last {insights?.windowDays ?? 30} days</div>
            {!insights || (insights.totals.profileViews + insights.totals.linkClicks + insights.totals.postTaps + insights.totals.messagesOpened) === 0 ? (
              <div className="tech-muted" style={{ fontSize: 12.5 }}>No activity yet. Views, link taps, post opens, and messages will show here as customers find your profile.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {([['Views', insights.totals.profileViews], ['Link taps', insights.totals.linkClicks], ['Post opens', insights.totals.postTaps], ['Messages', insights.totals.messagesOpened]] as const).map(([lbl, n]) => (
                    <div key={lbl} style={{ border: '1px solid var(--tech-border)', borderRadius: 10, padding: '8px 6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{n}</div>
                      <div className="tech-muted" style={{ fontSize: 10.5 }}>{lbl}</div>
                    </div>
                  ))}
                </div>
                {insights.dailyViews.length ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="tech-muted" style={{ fontSize: 11, marginBottom: 4 }}>Daily views</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }}>
                      {(() => {
                        const max = Math.max(...insights.dailyViews.map((d) => d.count), 1); return insights.dailyViews.map((d) => (
                          <div key={d.date} title={`${d.date}: ${d.count}`} style={{ flex: 1, height: `${Math.max(6, Math.round((d.count / max) * 44))}px`, background: '#C9962E', borderRadius: 3 }} />
                        ));
                      })()}
                    </div>
                  </div>
                ) : null}
                {insights.topLinks.length ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="tech-muted" style={{ fontSize: 11, marginBottom: 4 }}>Most-tapped links</div>
                    {insights.topLinks.map((l) => (
                      <div key={l.ref} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}><span style={{ textTransform: 'capitalize' }}>{l.ref}</span><span className="tech-muted">{l.count}</span></div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Ratings summary */}
          <div className="tech-card" style={{ padding: 14 }}>
            <div className="tech-label" style={{ marginBottom: 8 }}>My ratings</div>
            {!ratings || ratings.recent.length === 0 ? <div className="tech-muted" style={{ fontSize: 12.5 }}>Verified reviews from completed services will show here.</div> : (
              <>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{stars(ratings.overallRating)} <span className="tech-muted" style={{ fontSize: 12, fontWeight: 500 }}>· {ratings.ratingCount} reviews</span></div>
                {['5', '4', '3', '2', '1'].map((k) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 11, width: 34 }}>{k} star</span>
                    <div style={{ flex: 1, height: 5, borderRadius: 99, background: '#EFE6D6', overflow: 'hidden' }}><div style={{ width: `${pct(k)}%`, height: '100%', background: '#C9962E' }} /></div>
                    <span className="tech-muted" style={{ fontSize: 11, width: 30, textAlign: 'right' }}>{pct(k)}%</span>
                  </div>
                ))}
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {ratings.recent.slice(0, 5).map((r, i) => (
                    <div key={i} style={{ border: '1px solid var(--tech-border)', borderRadius: 12, padding: 10 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} <span className="tech-muted" style={{ fontWeight: 500 }}>· {r.reviewer}</span></div>
                      {r.comment ? <div style={{ fontSize: 12.5, marginTop: 3 }}>{r.comment}</div> : null}
                      {r.tags.length ? <div className="tech-muted" style={{ fontSize: 11, marginTop: 3 }}>{r.tags.join(' · ')}</div> : null}
                      {r.response ? <div style={{ fontSize: 12, marginTop: 5, paddingLeft: 8, borderLeft: '2px solid var(--tech-border)' }}><span className="tech-muted" style={{ fontWeight: 700 }}>Your response: </span>{r.response}</div> : null}
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        <input value={reply[r.ratingId] ?? ''} onChange={(e) => setReply({ ...reply, [r.ratingId]: e.target.value })}
                          placeholder={r.response ? 'Update your public response…' : 'Reply publicly…'} maxLength={1000}
                          style={{ flex: 1, fontSize: 12, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--tech-border)' }} />
                        <button className="tech-btn" style={{ fontSize: 12, padding: '5px 10px' }}
                          onClick={() => act(async () => { setRatings(await techApi.respondToReview(r.ratingId, reply[r.ratingId] ?? '')); setReply((m) => ({ ...m, [r.ratingId]: '' })); }, 'Response saved.')}>{r.response ? 'Update' : 'Reply'}</button>
                        {r.response ? <button className="tech-btn" style={{ fontSize: 12, padding: '5px 10px' }}
                          onClick={() => act(async () => setRatings(await techApi.respondToReview(r.ratingId, '')), 'Response removed.')}>Remove</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Services I can do at this salon (assigned by the salon) */}
          <div className="tech-card" style={{ padding: 14, marginBottom: 12 }}>
            <div className="tech-label" style={{ marginBottom: 6 }}>Services I can do here</div>
            {(p.servicesHere || []).length === 0 ? (
              <div className="tech-muted" style={{ fontSize: 12.5 }}>No services assigned yet — ask the front desk to add the services you perform.</div>
            ) : (
              <div>
                {(p.servicesHere as any[]).map((sv) => (
                  <div key={sv.serviceId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--tech-border)' }}>
                    <span>{sv.name}</span>{sv.isPrimary ? <span style={{ color: '#A96F22', fontWeight: 700, fontSize: 12 }}>Primary</span> : null}
                  </div>
                ))}
                <div className="tech-muted" style={{ fontSize: 11, marginTop: 6 }}>Set by your salon — these power your booking matches and "Services I Do".</div>
              </div>
            )}
          </div>

          {/* Connect to New Salon */}
          <div className="tech-card" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div className="tech-label">Connect to New Salon</div>
            <div className="tech-muted" style={{ fontSize: 12 }}>Moving salons? Your profile, portfolio, and verified reviews move with you. The new salon must approve — their private data and your old salon's stay separate.</div>
            <input style={input} value={salonCode} onChange={(e) => setSalonCode(e.target.value.toUpperCase())} placeholder="Salon code (ask the new salon)" aria-label="Salon code" />
            <input style={input} value={moveMsg} onChange={(e) => setMoveMsg(e.target.value)} placeholder="Message (optional)" aria-label="Request message" />
            <button className="tech-btn" disabled={busy || !salonCode.trim()} onClick={() => act(async () => { const r = await techApi.requestMembership(salonCode.trim(), moveMsg || undefined); setNote(r.message); setSalonCode(''); setMoveMsg(''); })}>Send Request</button>
            {p.memberships.length ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 2 }}>
                {p.memberships.map((m) => (
                  <div key={m.membershipId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--tech-border)' }}>
                    <span>{m.salonName}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: m.status === 'active' ? '#2E7D32' : m.status === 'pending' ? '#A96F22' : '#9A9287' }}>{m.status}</span>
                      {m.status === 'pending' ? <button className="tech-btn ghost" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busy} onClick={() => act(() => techApi.cancelMembershipRequest(m.membershipId), 'Request cancelled.')}>Cancel</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {photoToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete photo confirmation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(20, 12, 4, 0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            padding: 16,
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
          }}
          onClick={() => { if (!deletingPhoto) setPhotoToDelete(null); }}
        >
          <div
            className="tech-card"
            style={{
              width: '100%',
              maxWidth: 360,
              borderRadius: 20,
              margin: 0,
              padding: '24px 20px',
              textAlign: 'center',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid var(--tech-border)',
              background: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#FEE2E2',
                color: '#B91C1C',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 12px',
                fontSize: 24,
              }}
            >
              🗑️
            </div>

            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tech-text, #1E1B18)', marginBottom: 6 }}>
              Delete Photo?
            </div>

            <div className="tech-muted" style={{ fontSize: 12.5, lineHeight: 1.4, marginBottom: 16 }}>
              This will permanently remove this photo from your nail design portfolio.
            </div>

            {/* Photo preview in modal */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'rgba(20, 12, 4, 0.03)',
                borderRadius: 12,
                padding: '8px 12px',
                marginBottom: 20,
                textAlign: 'left',
                border: '1px solid var(--tech-border)',
              }}
            >
              <img
                src={photoToDelete.thumbnailUrl ?? photoToDelete.imageUrl}
                alt="Delete preview"
                style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', background: '#F4E9D8', flex: '0 0 auto', border: '1px solid var(--tech-border)' }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {photoDrafts[photoToDelete.photoId]?.caption || photoToDelete.caption || 'Nail design'}
                </div>
                <div className="tech-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {photoDrafts[photoToDelete.photoId]?.nailShape || photoToDelete.nailShape || 'Shape'} · {photoDrafts[photoToDelete.photoId]?.designStyle || photoToDelete.designStyle || 'Custom style'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <button
                type="button"
                className="tech-btn"
                style={{
                  background: 'var(--tech-danger, #B3261E)',
                  borderColor: 'var(--tech-danger, #B3261E)',
                  color: '#fff',
                  fontSize: 13.5,
                  fontWeight: 700,
                  height: 42,
                  borderRadius: 10,
                }}
                disabled={deletingPhoto}
                onClick={confirmDeletePhoto}
              >
                {deletingPhoto ? 'Deleting…' : 'Delete Photo'}
              </button>

              <button
                type="button"
                className="tech-btn ghost"
                style={{ fontSize: 13, height: 38, borderRadius: 10 }}
                disabled={deletingPhoto}
                onClick={() => setPhotoToDelete(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
