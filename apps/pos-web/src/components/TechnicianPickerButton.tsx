// TechnicianPickerButton.tsx — 200-technician mandate §57 / §2 (Oct 26 2026): the Booking board's remaining technician
// <select>s (the appointment-list filter, the drawer's Assign, Move Appointment) listed all 200 names. This is a compact
// button that shows the current choice and opens the server-paged TechnicianPicker (search by name / phone / "#roster",
// 12 a page) in a popover. The board no longer needs the whole roster in memory.
import { useEffect, useRef, useState } from 'react';
import type { BookingTechnicianSummary } from '@aipowersalon/api-contracts/tenant';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TechnicianPicker } from './TechnicianPicker';

export function TechnicianPickerButton({ value, valueName, onChange, emptyLabel, anyLabel, date, serviceIds, workingOnlyDefault = false, ariaLabel, style }: {
  value: string;
  /** the chosen technician's name when known (the picker's page may not hold it) */
  valueName?: string;
  onChange: (technicianId: string, tech?: BookingTechnicianSummary) => void;
  /** button text when nothing is chosen */
  emptyLabel: string;
  /** a first choice that sends '' ("All technicians", "Keep unassigned") */
  anyLabel?: string;
  date?: string;
  serviceIds?: string[];
  workingOnlyDefault?: boolean;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | undefined>(valueName);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (valueName) setName(valueName); }, [valueName]);
  useEffect(() => { if (!value) setName(undefined); }, [value]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = value ? (name ?? valueName ?? value) : emptyLabel;
  return (
    <div ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} data-testid="technician-picker-button"
        onClick={() => setOpen((o) => !o)}
        style={{ font: 'inherit', fontSize: 13, height: 44, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8', cursor: 'pointer', textAlign: 'left', minWidth: 160, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}>
        {shown} ▾
      </button>
      {open ? (
        <div style={{ position: 'absolute', zIndex: 90, top: 'calc(100% + 4px)', left: 0, width: 'min(360px, 90vw)', background: '#FFF', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: 10 }}>
          <TechnicianPicker value={value} selectedName={name} anyLabel={anyLabel} date={date} serviceIds={serviceIds} workingOnlyDefault={workingOnlyDefault}
            onChange={(id, t) => { setName(t?.name); onChange(id, t); setOpen(false); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)} style={{ fontSize: 12 }}>{tx('pos.close')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
