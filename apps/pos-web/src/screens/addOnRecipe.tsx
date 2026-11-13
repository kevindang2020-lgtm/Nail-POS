// addOnRecipe.tsx — extras ADD-ONS MANAGEMENT 06 (round 11, Nov 13 2026): the "Recipe" tab of an add-on's details. An add-on
// may consume inventory — Kevin decides whether it does, so the salon switch is OFF unless turned on: while off the screen says
// that nothing is deducted for add-ons (exactly as before) and a saved recipe only waits. When on, Service Done deducts the
// recipe the same way a service recipe is deducted (once per ticket line; a removed line or voided ticket gives it back).
// Whole quantities only. The server decides everything; this screen only shows and saves.
import { useEffect, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { inventoryApi, type InvProduct } from '../api/inventoryApi';
import { useLoad, StateBlock } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';

export function AddOnRecipePanel({ addOnKey }: { addOnKey: string }) {
  const can = useCan(); const canEdit = can('inventory.update'); const canSwitch = can('settings.edit');
  const [tick, setTick] = useState(0);
  const r = useLoad(() => inventoryApi.addOnRecipe(addOnKey), [addOnKey, tick]);
  const prods = useLoad(() => (canEdit ? inventoryApi.products() : Promise.resolve({ products: [] as InvProduct[] })), [canEdit]);
  const [lines, setLines] = useState<{ productId: string; productName: string; quantity: string }[]>([]);
  const [addPid, setAddPid] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [saved, setSaved] = useState(false); const [ask, setAsk] = useState(false);
  useEffect(() => { if (r.data) setLines(r.data.lines.map((l) => ({ productId: l.productId, productName: l.productName, quantity: String(l.quantity) }))); }, [r.data]);
  if (r.error) return <StateBlock error={r.error} onRetry={r.reload} />;
  const x = r.data;
  if (!x) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const whole = (q: string) => (/^\d{1,4}$/.test(q) && Number(q) >= 1 && Number(q) <= 1000 ? Number(q) : 0);
  const invalid = lines.some((l) => whole(l.quantity) === 0);
  const available = (prods.data?.products ?? []).filter((p) => !lines.some((l) => l.productId === p.id));
  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try { await inventoryApi.setAddOnRecipe(addOnKey, lines.map((l) => ({ productId: l.productId, quantity: whole(l.quantity) }))); setSaved(true); setTick((n) => n + 1); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const flip = async (enabled: boolean) => {
    setBusy(true); setErr(null);
    try { await inventoryApi.setAddOnRecipeSetting(enabled); setAsk(false); setTick((n) => n + 1); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div data-testid="ad-recipe">
      <div className={'fk-note ' + (x.deductsAtServiceDone ? 'ok' : '')} role="status" data-testid="ad-recipe-state">
        <span>{x.deductsAtServiceDone ? tx('cg.aor.on') : tx('cg.aor.off')}</span>
        {canSwitch ? (ask
          ? <span data-testid="ad-recipe-switch-confirm"> {tx(x.deductsAtServiceDone ? 'cg.aor.offConfirm' : 'cg.aor.onConfirm')} <button type="button" className="fk-btn sm" disabled={busy} onClick={() => void flip(!x.deductsAtServiceDone)} data-testid="ad-recipe-switch-yes">{tx(x.deductsAtServiceDone ? 'cg.aor.turnOff' : 'cg.aor.turnOn')}</button> <button type="button" className="fk-btn ghost sm" onClick={() => setAsk(false)}>{tx('pos.cancel')}</button></span>
          : <> <button type="button" className="fk-link" onClick={() => setAsk(true)} data-testid="ad-recipe-switch">{tx(x.deductsAtServiceDone ? 'cg.aor.turnOff' : 'cg.aor.turnOn')}</button></>) : null}
      </div>
      <p className="fk-hint">{tx('cg.aor.rule')}</p>
      {lines.length === 0 ? <p className="fk-hint" data-testid="ad-recipe-empty">{tx('cg.aor.empty')}</p> : (
        <table className="fk-table fn-table cg-table"><thead><tr><th>{tx('pos.product')}</th><th className="num">{tx('cg.aor.qty')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.productId} data-testid="ad-recipe-line"><td>{l.productName}</td>
            <td className="num">{canEdit ? <input className="fk-input" style={{ width: 72 }} inputMode="numeric" aria-label={tx('cg.aor.qty')} aria-invalid={whole(l.quantity) === 0} value={l.quantity}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setSaved(false); setLines((xs) => xs.map((y) => (y.productId === l.productId ? { ...y, quantity: v } : y))); }} data-testid="ad-recipe-qty" /> : l.quantity}</td>
            <td className="fn-acts">{canEdit ? <button type="button" className="fk-btn ghost sm" onClick={() => { setSaved(false); setLines((xs) => xs.filter((y) => y.productId !== l.productId)); }}>{tx('pos.remove')}</button> : null}</td></tr>)}</tbody></table>
      )}
      {canEdit ? <div className="fk-row">
        <select className="fk-input" value={addPid} onChange={(e) => setAddPid(e.target.value)} aria-label={tx('pos.add_product_2')} data-testid="ad-recipe-add-pick">
          <option value="">{tx('pos.select_a_product')}</option>
          {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className="fk-btn ghost sm" disabled={!addPid} onClick={() => { const p = available.find((y) => y.id === addPid); if (p) { setLines((xs) => [...xs, { productId: p.id, productName: p.name, quantity: '1' }]); setAddPid(''); setSaved(false); } }} data-testid="ad-recipe-add">{tx('pos.add')}</button>
        <button type="button" className="fk-btn primary sm" disabled={busy || invalid} onClick={() => void save()} data-testid="ad-recipe-save">{busy ? tx('pos.saving_2') : tx('cg.aor.save')}</button>
        {saved ? <span className="fk-hint" role="status" data-testid="ad-recipe-saved">{x.deductsAtServiceDone ? tx('cg.aor.savedOn') : tx('cg.aor.savedOff')}</span> : null}
      </div> : null}
      {err ? <StateBlock error={err} onRetry={() => setErr(null)} /> : null}
    </div>
  );
}
