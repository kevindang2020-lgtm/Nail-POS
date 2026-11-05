// AssignTechSheet.tsx — one reusable slide-over for assigning a ticket to a technician, shared by every POS entry
// point (Serving "Manage", Customer Queue rows + Quick Assign, etc.). Matches the SkipLineDrawer overlay pattern and
// the cream/gold design tokens. It loads the technician roster itself from /pos/technicians/state (so call sites do
// not each re-fetch); pass a `roster` to reuse one a screen already has. The caller supplies `onAssign`, which wires
// the correct already-live endpoint for its stage (posServingApi / posQueueApi / posCheckInApi …) — no endpoint logic
// lives here, so there is exactly one picker and no duplication.
import { useEffect, useMemo, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { viIncludes } from '@aipowersalon/api-contracts';
import { api } from '../api/client';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TechnicianPicker } from './TechnicianPicker';

export type AssignTech = { technicianId: string; displayName: string; workingStatus?: string; status?: string; activeAssignments?: number };
export type AssignGuest = { id: string; name: string; meta?: string; isVip?: boolean };

type Avail = { label: string; cls: 'ok' | 'warn' | '' };
function availability(t: AssignTech): Avail {
  const w = (t.workingStatus || t.status || '').toLowerCase();
  if (/avail|idle|ready|free/.test(w)) return { label: tx('pos.available'), cls: 'ok' };
  if (/break/.test(w)) return { label: tx('pos.break'), cls: 'warn' };
  if (/off|inactive|suspend/.test(w)) return { label: tx('pos.offline_4'), cls: '' };
  if (/serv|busy|in_?service|progress/.test(w)) return { label: tx('pos.busy'), cls: 'warn' };
  return { label: tx('pos.on_floor'), cls: '' };
}
const initials = (n: string) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';

export function AssignTechSheet(props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  context?: string;
  currentTechName?: string | null;
  allowUnassign?: boolean;
  guests?: AssignGuest[];
  selectedGuestId?: string | null;
  onSelectGuest?: (id: string) => void;
  confirmLabel?: string;
  roster?: AssignTech[];
  /** 200-technician salons: pick from the server-paged TechnicianPicker (search + 12 a page) instead of a roster list —
   *  a roster from /pos/technicians/state is only its first page */
  paged?: boolean;
  onAssign: (technicianId: string | null) => Promise<void>;
}) {
  const { open, onClose, onAssign } = props;
  const [roster, setRoster] = useState<AssignTech[]>(props.roster || []);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string>('');
  const [busy, setBusy] = useState<null | 'assign' | 'unassign'>(null);
  const [note, setNote] = useState<string | null>(null);

  // load roster on open (unless the caller supplied one)
  const loadRosterOnOpen = useEventCallback(() => {
    if (!open) return;
    setQ(''); setSel(''); setNote(null);
    if (props.paged) return;
    if (props.roster && props.roster.length) { setRoster(props.roster); return; }
    setLoading(true);
    (api.get('/pos/technicians/state') as Promise<{ rows: { items: AssignTech[] } }>)
      .then((d) => setRoster((d?.rows?.items || []).filter((t) => (t.status || 'active').toLowerCase() === 'active')))
      .catch(() => setRoster([]))
      .finally(() => setLoading(false));
     
  });
  useEffect(() => loadRosterOnOpen(), [open, loadRosterOnOpen]);

  const list = useMemo(() => {
    const s = q.trim();
    const rows = s ? roster.filter((t) => viIncludes(t.displayName, s)) : roster;   // accent-insensitive (§41)
    // available first, then by name
    return [...rows].sort((a, b) => {
      const aa = availability(a).cls === 'ok' ? 0 : 1, bb = availability(b).cls === 'ok' ? 0 : 1;
      return aa - bb || (a.displayName || '').localeCompare(b.displayName || '');
    });
  }, [roster, q]);

  if (!open) return null;

  const run = async (fn: () => Promise<void>, which: 'assign' | 'unassign') => {
    setNote(null); setBusy(which);
    try { await fn(); onClose(); }
    catch (e: any) { setNote(e?.message || tx('pos.assignment_failed')); }
    finally { setBusy(null); }
  };

  const sheet: React.CSSProperties = { position: 'absolute', top: 0, right: 0, width: 'min(432px, 94vw)', height: '100%', background: '#FBF6EC', boxShadow: '-14px 0 44px rgba(0,0,0,.22)', display: 'flex', flexDirection: 'column', zIndex: 61 };
  const lab: React.CSSProperties = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '2px 2px 7px' };
  const av: React.CSSProperties = { width: 30, height: 30, borderRadius: '50%', background: 'var(--grad)', border: '1px solid #C9933B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#5a4413', flex: 'none' };

  return (
    <div role="dialog" aria-modal="true" aria-label={props.title || tx('pos.assign_technician')} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(30,24,16,.40)' }} />
      <aside style={sheet}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid rgba(169,111,34,.2)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{props.title || tx('pos.assign_technician_2')}</div>
            {props.context ? <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{props.context}</div> : null}
          </div>
          <button aria-label={tx('pos.close')} onClick={onClose} style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', color: '#9a8c79', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ padding: '13px 16px', overflow: 'auto', flex: 1 }}>
          {note ? <div role="alert" style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#FDE7E7', color: '#B42318', fontSize: 12.5 }}>{note}</div> : null}

          {/* guest selector (quick-assign variant) */}
          {props.guests && props.guests.length ? (
            <>
              <div style={lab}>{tx('pos.guest')}</div>
              {(() => {
                const g = props.guests!.find((x) => x.id === props.selectedGuestId) || props.guests![0];
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', border: '1.5px solid #E6CFA0', borderRadius: 11, background: '#fff', marginBottom: props.guests!.length > 1 ? 6 : 12 }}>
                    <div style={{ ...av, width: 32, height: 32, background: '#FCEFD8', border: '1px solid #ECCF92', color: '#8B5A18' }}>{initials(g.name)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{g.name}{g.isVip ? <span className="pill warn" style={{ marginLeft: 6 }}>VIP</span> : null}</div>
                      {g.meta ? <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{g.meta}</div> : null}
                    </div>
                  </div>
                );
              })()}
              {props.guests.length > 1 && props.onSelectGuest ? (
                <select value={props.selectedGuestId || props.guests[0].id} onChange={(e) => props.onSelectGuest!(e.target.value)} style={{ width: '100%', height: 32, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#fff', fontFamily: 'inherit', fontSize: 12, marginBottom: 12 }}>
                  {props.guests.map((g) => <option key={g.id} value={g.id}>{g.name}{g.meta ? ' — ' + g.meta : ''}</option>)}
                </select>
              ) : null}
            </>
          ) : null}

          {/* current technician + unassign */}
          {props.currentTechName ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', border: '1px dashed #E0C794', borderRadius: 10, background: '#FCF6E9', marginBottom: 12 }}>
              <div style={{ ...av, width: 28, height: 28 }}>{initials(props.currentTechName)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 12 }}>{tx('pos.currently')}{' '}{props.currentTechName}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.picking_another_reassigns_this_ticket')}</div>
              </div>
              {props.allowUnassign ? (
                <button className="pill" style={{ marginLeft: 'auto', background: '#FBEEEA', borderColor: '#E9C9C1', color: '#B85B4D', cursor: 'pointer' }} disabled={!!busy} onClick={() => run(() => onAssign(null), 'unassign')}>{busy === 'unassign' ? '…' : tx('pos.unassign')}</button>
              ) : null}
            </div>
          ) : null}

          <div style={lab}>{tx('pos.assign_to')}</div>
          {props.paged ? <TechnicianPicker value={sel} onChange={(id) => setSel(id)} /> : <>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <span style={{ position: 'absolute', left: 10, top: 8, color: '#b6a78f' }} aria-hidden>⌕</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('pos.search_technicians')} autoFocus style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 12px 0 30px', fontSize: 12, background: '#fff', fontFamily: 'inherit' }} />
          </div>

          {loading ? <div style={{ color: 'var(--muted)', padding: '20px 4px', fontSize: 12.5 }}>{tx('pos.loading_technicians')}</div>
            : list.length === 0 ? <div style={{ color: 'var(--muted)', padding: '20px 4px', fontSize: 12.5 }}>{q ? tx('pos.no_technicians_match') : tx('pos.no_active_technicians')}</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((t) => {
                  const a = availability(t); const seld = sel === t.technicianId;
                  return (
                    <button key={t.technicianId} onClick={() => setSel(t.technicianId)} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', background: seld ? '#FFF7EE' : '#fff', border: seld ? '1.5px solid var(--orange)' : '1px solid var(--line)', boxShadow: seld ? tx('pos.0_0_0_3px_rgba_232_1neq') : 'none', fontFamily: 'inherit' }}>
                      <div style={av}>{initials(t.displayName)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 12.5 }}>{t.displayName}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {typeof t.activeAssignments === 'number' ? <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{t.activeAssignments === 0 ? tx('ops.assign.free') : tx('ops.assign.guests', { count: String(t.activeAssignments) })}</span> : null}
                        <span className={'pill' + (a.cls ? ' ' + a.cls : '')}>{a.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(169,111,34,.18)', display: 'flex', gap: 8, background: '#FBF6EC' }}>
          <button className="btn ghost" style={{ flex: 1, textAlign: 'center', padding: 10 }} onClick={onClose} disabled={!!busy}>{tx('pos.cancel')}</button>
          <button
            className="btn"
            style={{
              flex: 1,
              textAlign: 'center',
              padding: 10,
              background: sel ? 'var(--aps-orange, #E8852B)' : '#EAE0D0',
              borderColor: sel ? 'var(--aps-orange, #E8852B)' : '#DFD3C0',
              color: sel ? '#FFFFFF' : '#7A6A55',
              fontWeight: 800,
              fontSize: 13.5,
              cursor: sel && !busy ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
            }}
            disabled={!sel || !!busy}
            onClick={() => run(() => onAssign(sel), 'assign')}
          >
            {busy === 'assign' ? tx('pos.assigning') : (props.confirmLabel || tx('pos.assign'))}
          </button>
        </div>
      </aside>
    </div>
  );
}
