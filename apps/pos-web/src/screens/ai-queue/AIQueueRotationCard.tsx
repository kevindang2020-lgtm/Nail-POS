// AIQueueRotationCard.tsx — rotation policy + the fixed turn order (BUILD_PLAN Phase 6).
//
// Audit bug 7: GET /rotation-policy answered a bare string, so `res.json()` threw and the whole AI Queue screen failed
// to load (the old test mocked the string and never noticed). It now answers `{ policy, fixedOrder }` JSON, and this
// card loads on its own — a failure here can never blank the rest of the screen.
// "Fixed turn order" finally has data to work with: managers set the order here (up / down / remove / add).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueRotationPolicy } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as api } from '../../api/posAIQueueAssignmentApi';
import { card, cardHead, input, btnGold, btnGhost, muted, errText, okText, errMsg, ROTATION } from './aiQueueUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

export function AIQueueRotationCard({ tick, can, roster, techName }: { tick: number; can: (p: string) => boolean; roster: { technicianId: string; name: string }[]; techName: (id: string | null | undefined) => string }) {
  const [policy, setPolicy] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);   // a realtime refresh must not wipe an order the manager is still arranging
  const setDirty = (v: boolean) => { dirtyRef.current = v; setDirtyState(v); };

  const load = useCallback(async () => {
    try { const r = await api.getRotationPolicy(); setPolicy(r.policy || 'traditional_weighted_rotation'); setOrder(Array.isArray(r.fixedOrder) ? r.fixedOrder : []); setDirty(false); setErr(null); }
    catch (e) { setErr(errMsg(e, tx('growth.aiQueue.err.rotation'))); }
  }, []);
  useEffect(() => { if (!dirtyRef.current) void load(); }, [load, tick]);

  const canEdit = can('ai_queue_assignment.manage_rules');
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; setOrder(n); setDirty(true); };
  const remove = (i: number) => { setOrder(order.filter((_, k) => k !== i)); setDirty(true); };
  const addTech = () => { if (!add || order.includes(add)) return; setOrder([...order, add]); setAdd(''); setDirty(true); };
  const save = async () => {
    if (!policy) return;
    if (policy === 'manual_order' && order.length === 0) { setErr(tx('pos.add_the_technicians_in_the_order_5ybo')); return; }
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await api.setRotationPolicy({ policy: policy as QueueRotationPolicy, fixedOrder: order }); setPolicy(r.policy); setOrder(r.fixedOrder || order); setDirty(false); setMsg(tx('pos.rotation_saved')); }
    catch (e) { setErr(errMsg(e, tx('growth.aiQueue.err.save'))); } finally { setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={cardHead}>{tx('pos.turn_rotation')}</div>
      {err ? <div role="alert" style={{ ...errText, marginBottom: 8 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ ...okText, marginBottom: 8 }}>{msg}</div> : null}
      {policy == null ? <div style={muted}>{err ? '' : tx('pos.loading')}</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 2 }}><span style={muted}>{tx('pos.how_turns_rotate')}</span>
            <select aria-label={tx('pos.rotation_policy')} style={input} value={policy} disabled={!canEdit} onChange={(e) => { setPolicy(e.target.value); setDirty(true); }}>
              {ROTATION().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {policy === 'manual_order' || order.length > 0 ? (
            <div style={{ display: 'grid', gap: 4 }} aria-label={tx('pos.fixed_turn_order')}>
              <span style={muted}>{tx('pos.turn_order')}{policy !== 'manual_order' ? tx('pos.used_only_with_manual_order') : ''}</span>
              {order.length === 0 ? <div style={muted}>{tx('pos.nobody_in_the_order_yet')}</div> : order.map((t, i) => (
                <div key={t} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ width: 20, color: '#8A857E', fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13 }}>{techName(t)}</span>
                  {canEdit ? <>
                    <button style={{ ...btnGhost, height: 26, padding: '0 8px' }} aria-label={tx('pos.move_t_up', { t: String(techName(t)) })} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button style={{ ...btnGhost, height: 26, padding: '0 8px' }} aria-label={tx('pos.move_t_down', { t: String(techName(t)) })} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button style={{ ...btnGhost, height: 26, padding: '0 8px' }} aria-label={tx('pos.remove_t', { t: String(techName(t)) })} onClick={() => remove(i)}>✕</button>
                  </> : null}
                </div>
              ))}
              {canEdit ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select aria-label={tx('pos.add_technician_to_order')} style={{ ...input, flex: 1 }} value={add} onChange={(e) => setAdd(e.target.value)}>
                    <option value="">{tx('pos.add_a_technician')}</option>
                    {roster.filter((r) => !order.includes(r.technicianId)).map((r) => <option key={r.technicianId} value={r.technicianId}>{r.name}</option>)}
                  </select>
                  <button style={btnGhost} disabled={!add} onClick={addTech}>{tx('pos.add')}</button>
                </div>
              ) : null}
            </div>
          ) : null}
          {canEdit ? <div><button style={btnGold} disabled={busy || !dirty} onClick={save}>{tx('pos.save_rotation')}</button></div> : null}
        </div>
      )}
    </div>
  );
}
