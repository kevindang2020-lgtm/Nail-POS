// OwnerBranchSelector — the Owner App top-bar salon switcher. Lists ONLY the salons assigned to the signed-in owner
// (from useOwnerBranch, backed by GET /owner/context) plus an "All My Salons" combined option that appears only when
// the owner has more than one assigned salon. With exactly one salon it renders a static label (no dropdown), per spec.
// Changing the selection updates the shared context; every screen reads effectiveBranchId and reloads — and the backend
// re-checks the branch on every request, so the dropdown is a convenience, never the security boundary.
//
// Multi-salon switch PIN: a salon may carry a 6-digit "switch PIN" (set by the super admin). Tapping such a salon opens
// the PIN pad; only a PIN the server accepts (POST /owner/context/select with { pin }) actually commits the switch. The
// pad is a convenience prompt — enforcement is server-side, so a tampered client still cannot switch without the PIN.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useOwnerBranch } from './OwnerBranchContext';
import { ownerContextApi } from '../api/ownerApi';

// Self-contained 6-box PIN entry. Auto-advances, accepts Backspace/Enter, and on a wrong PIN shakes + clears + refocuses.
// `verify` resolves true when the server accepted the PIN (the parent then unmounts this pad); false re-prompts.
function PinPad({ salonName, onCancel, verify }: { salonName: string; onCancel: () => void; verify: (pin: string) => Promise<boolean> }) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => { refs.current[0]?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async (code: string) => {
    setBusy(true); setBad(false);
    const ok = await verify(code);
    if (!ok) { setBusy(false); setBad(true); setDigits(['', '', '', '', '', '']); setTimeout(() => refs.current[0]?.focus(), 0); }
    // On success the parent removes the pad, so no further state work is needed here.
  };
  const onChange = (i: number, v: string) => {
    if (busy) return;
    const d = v.replace(/\D/g, '').slice(-1);
    const next = digits.slice(); next[i] = d;
    setDigits(next);
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (next.every(Boolean) && next.join('').length === 6) void submit(next.join(''));
  };
  const onKeyDown = (i: number, e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'Enter' && digits.every(Boolean)) void submit(digits.join(''));
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Enter the switch PIN for ${salonName}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(20,16,10,.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <style>{'@keyframes ownerPinShake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}.owner-pin-shake{animation:ownerPinShake .3s both}'}</style>
      <div style={{ width: 324, maxWidth: '92vw', background: '#fff', borderRadius: 14, padding: '22px 22px 18px', boxShadow: '0 18px 50px rgba(0,0,0,.3)', fontFamily: 'inherit' }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2, color: '#2a2118' }}>Enter salon PIN</div>
        <div style={{ color: '#6b6257', fontSize: 13, marginBottom: 14 }}>Enter the 6-digit PIN to switch into <strong>{salonName}</strong>.</div>
        <div className={bad ? 'owner-pin-shake' : ''} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginBottom: 10 }}>
          {digits.map((d, i) => (
            <input key={i} ref={(el) => { refs.current[i] = el; }} value={d}
              onChange={(e) => onChange(i, e.target.value)} onKeyDown={(e) => onKeyDown(i, e)}
              inputMode="numeric" maxLength={1} aria-label={`PIN digit ${i + 1}`} disabled={busy}
              style={{ width: 40, height: 48, textAlign: 'center', fontSize: 20, fontWeight: 700, borderRadius: 10, border: `1.5px solid ${bad ? '#d9534f' : '#d9cdb8'}`, background: busy ? '#f4f0e8' : '#fff', color: '#2a2118' }} />
          ))}
        </div>
        {bad ? <div style={{ color: '#c0392b', fontSize: 12.5, marginBottom: 8 }}>That PIN didn’t match. Try again.</div> : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {busy ? <span style={{ color: '#6b6257', fontSize: 12, marginRight: 'auto' }}>Checking…</span> : null}
          <button type="button" onClick={onCancel} style={{ padding: '8px 14px', borderRadius: 9, border: '1px solid #d9cdb8', background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#2a2118' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function OwnerBranchSelector() {
  const { loading, error, branches, canViewAll, selection, currentLabel, setSelection, reload } = useOwnerBranch();
  const [open, setOpen] = useState(false);
  const [pinFor, setPinFor] = useState<{ branchId: string; salonName: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Commit a switch into a single salon. PIN-protected salons go through the pad; others switch immediately.
  const chooseSingle = (b: { branchId: string; salonName: string; hasSwitchPin: boolean }) => {
    if (b.hasSwitchPin) { setPinFor({ branchId: b.branchId, salonName: b.salonName }); setOpen(false); return; }
    setSelection({ mode: 'single', branchId: b.branchId });
    void ownerContextApi.select('single', b.branchId).catch(() => {});
    setOpen(false);
  };

  if (loading) {
    return (<div className="owner-salonbar"><div className="owner-salonbar-btn skeleton" aria-hidden="true"><span className="pin">◈</span><span className="lbl">Loading your salons…</span></div></div>);
  }
  if (error) {
    return (<div className="owner-salonbar"><button className="owner-salonbar-btn err" onClick={reload}>Couldn’t load your salons — Retry</button></div>);
  }

  // One assigned salon → no switcher; just show where you are.
  if (branches.length <= 1) {
    return (
      <div className="owner-salonbar">
        <div className="owner-salonbar-btn static" aria-label="Current salon">
          <span className="pin" aria-hidden="true">◈</span>
          <span className="lbl">{currentLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="owner-salonbar" ref={ref}>
        <button className="owner-salonbar-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="pin" aria-hidden="true">◈</span>
          <span className="lbl">{currentLabel}</span>
          <span className={`chev ${open ? 'up' : ''}`} aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="owner-salonmenu" role="listbox" aria-label="Choose salon">
            {canViewAll && (
              <button
                role="option"
                aria-selected={selection.mode === 'all'}
                className={`owner-salonopt ${selection.mode === 'all' ? 'sel' : ''}`}
                onClick={() => { setSelection({ mode: 'all', branchId: null }); void ownerContextApi.select('all').catch(() => {}); setOpen(false); }}
              >
                <span className="nm">All My Salons</span>
                <span className="meta">Combined · {branches.length} locations</span>
                {selection.mode === 'all' && <span className="ck" aria-hidden="true">✓</span>}
              </button>
            )}
            {branches.map((b) => {
              const sel = selection.mode === 'single' && selection.branchId === b.branchId;
              const where = [b.city, b.state].filter(Boolean).join(', ');
              const meta = [where, b.hasSwitchPin ? 'PIN to switch' : ''].filter(Boolean).join(' · ');
              return (
                <button
                  key={b.branchId}
                  role="option"
                  aria-selected={sel}
                  className={`owner-salonopt ${sel ? 'sel' : ''}`}
                  onClick={() => chooseSingle(b)}
                >
                  <span className="nm">
                    {b.salonName}
                    {b.isPrimaryOwner ? <span className="primary">Primary</span> : null}
                    {b.hasSwitchPin ? <span aria-label="PIN required" title="PIN required to switch" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.4px', color: '#A96F22', border: '1px solid #e3d4b4', borderRadius: 5, padding: '1px 4px' }}>PIN</span> : null}
                  </span>
                  {meta && <span className="meta">{meta}</span>}
                  {sel && <span className="ck" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {pinFor && (
        <PinPad
          salonName={pinFor.salonName}
          onCancel={() => setPinFor(null)}
          verify={async (pin) => {
            try {
              await ownerContextApi.select('single', pinFor.branchId, pin);
              setSelection({ mode: 'single', branchId: pinFor.branchId });
              setPinFor(null);
              return true;
            } catch {
              return false;
            }
          }}
        />
      )}
    </>
  );
}
