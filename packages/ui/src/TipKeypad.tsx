// TipKeypad.tsx — the shared touchscreen custom-tip keypad (Custom Tip spec, Jul 26 2026). One component, used by
// every POS-class checkout surface, on top of the ONE shared parser in money-input.ts. Cream/gold design tokens with
// safe fallbacks; every key is a ≥44px touch target (ASUS V470 requirement).
import React, { useState } from 'react';
import { parseDollarsToCents, formatCentsUsd, keypadPress } from './money-input';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export function TipKeypad({ title = 'Custom Tip', onApply, onCancel, applyLabel = 'Apply Tip', disabled = false }: {
  title?: string;
  onApply: (cents: number) => void;
  onCancel: () => void;
  applyLabel?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState('');
  const cents = parseDollarsToCents(raw);
  const canApply = !disabled && cents != null && cents > 0;
  return (
    <div role="dialog" aria-label={title} style={{ background: 'var(--card, #fff)', border: '1px solid var(--line, #E7DCC8)', borderRadius: 14, padding: 16, width: 300, boxShadow: '0 12px 34px rgba(60,42,10,.18)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{title}</div>
      <div aria-label="tip amount" style={{ fontSize: 30, fontWeight: 800, textAlign: 'center', padding: '8px 0 12px', color: 'var(--ink, #2B2013)' }}>{raw === '' ? '$0.00' : formatCentsUsd(cents ?? 0)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {KEYS.map((k) => (
          <button key={k} type="button" disabled={disabled} onClick={() => setRaw((r) => keypadPress(r, k))}
            style={{ minHeight: 48, fontSize: 18, fontWeight: 800, borderRadius: 10, border: '1px solid var(--line, #E7DCC8)', background: '#fff', cursor: 'pointer', color: 'var(--ink, #2B2013)' }}>
            {k}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={onCancel} disabled={disabled}
          style={{ minHeight: 46, borderRadius: 10, border: '1px solid var(--line, #E7DCC8)', background: '#fff', fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={() => { if (canApply) onApply(cents!); }} disabled={!canApply}
          style={{ minHeight: 46, borderRadius: 10, border: '1px solid var(--gold, #A96F22)', background: canApply ? 'var(--gold, #A96F22)' : '#D9C9AC', color: '#fff', fontWeight: 800, cursor: canApply ? 'pointer' : 'not-allowed' }}>{applyLabel}</button>
      </div>
    </div>
  );
}
