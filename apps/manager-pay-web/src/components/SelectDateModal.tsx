import { useState, useEffect } from 'react';

export type DateFilterType =
  | 'Today'
  | 'Yesterday'
  | 'This Week'
  | 'Last Week'
  | 'This Month'
  | 'Last Month'
  | 'This Quarter'
  | 'Last Quarter'
  | 'Specific Day'
  | 'Custom Range';

export const ALL_PRESETS: DateFilterType[] = [
  'Today',
  'Yesterday',
  'This Week',
  'Last Week',
  'This Month',
  'Last Month',
  'This Quarter',
  'Last Quarter',
];

export interface DateRangeResult {
  type: DateFilterType;
  startDate: string; // ISO 8601 string
  endDate: string;   // ISO 8601 string
  label: string;     // Short friendly label e.g. "Today", "Nov 2 – Nov 8"
  customFrom?: string; // YYYY-MM-DD
  customTo?: string;   // YYYY-MM-DD
}

export function computeDateRange(
  type: DateFilterType,
  specificDate?: string, // YYYY-MM-DD
  customFrom?: string,   // YYYY-MM-DD
  customTo?: string,     // YYYY-MM-DD
): DateRangeResult | null {
  const now = new Date();

  if (type === 'Today') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: 'Today' };
  }

  if (type === 'Yesterday') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: 'Yesterday' };
  }

  if (type === 'This Week') {
    const day = now.getDay();
    const diff = (day + 6) % 7; // Monday is 0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff, 0, 0, 0, 0);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6, 23, 59, 59, 999);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { type, startDate: monday.toISOString(), endDate: sunday.toISOString(), label: `${fmt(monday)} – ${fmt(sunday)}` };
  }

  if (type === 'Last Week') {
    const day = now.getDay();
    const diff = (day + 6) % 7;
    const lastMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff - 7, 0, 0, 0, 0);
    const lastSunday = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + 6, 23, 59, 59, 999);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { type, startDate: lastMonday.toISOString(), endDate: lastSunday.toISOString(), label: `${fmt(lastMonday)} – ${fmt(lastSunday)}` };
  }

  if (type === 'This Month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }

  if (type === 'Last Month') {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: prevMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }

  if (type === 'This Quarter') {
    const qm = Math.floor(now.getMonth() / 3) * 3;
    const s = new Date(now.getFullYear(), qm, 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), qm + 3, 0, 23, 59, 59, 999);
    const qNum = Math.floor(now.getMonth() / 3) + 1;
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: `Q${qNum} ${now.getFullYear()}` };
  }

  if (type === 'Last Quarter') {
    const qm = Math.floor(now.getMonth() / 3) * 3;
    const prevQYear = qm === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const prevQm = qm === 0 ? 9 : qm - 3;
    const s = new Date(prevQYear, prevQm, 1, 0, 0, 0, 0);
    const e = new Date(prevQYear, prevQm + 3, 0, 23, 59, 59, 999);
    const qNum = Math.floor(prevQm / 3) + 1;
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: `Q${qNum} ${prevQYear}` };
  }

  if (type === 'Specific Day') {
    if (!specificDate) return null;
    const [y, m, d] = specificDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    const s = new Date(y, m - 1, d, 0, 0, 0, 0);
    const e = new Date(y, m - 1, d, 23, 59, 59, 999);
    const label = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label, customFrom: specificDate };
  }

  if (type === 'Custom Range') {
    if (!customFrom || !customTo) return null;
    const [y1, m1, d1] = customFrom.split('-').map(Number);
    const [y2, m2, d2] = customTo.split('-').map(Number);
    if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
    let s = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
    let e = new Date(y2, m2 - 1, d2, 23, 59, 59, 999);
    if (s.getTime() > e.getTime()) {
      s = new Date(y2, m2 - 1, d2, 0, 0, 0, 0);
      e = new Date(y1, m1 - 1, d1, 23, 59, 59, 999);
    }
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { type, startDate: s.toISOString(), endDate: e.toISOString(), label: `${fmt(s)} – ${fmt(e)}`, customFrom, customTo };
  }

  return null;
}

interface SelectDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeType?: DateFilterType;
  initialFrom?: string;
  initialTo?: string;
  onSelect: (result: DateRangeResult) => void;
}

export function SelectDateModal({
  isOpen,
  onClose,
  activeType = 'This Week',
  initialFrom = '',
  initialTo = '',
  onSelect,
}: SelectDateModalProps) {
  const [selectedType, setSelectedType] = useState<DateFilterType>(activeType);
  const [specificDay, setSpecificDay] = useState(activeType === 'Specific Day' ? initialFrom : '');
  const [rangeFrom, setRangeFrom] = useState(activeType === 'Custom Range' ? initialFrom : '');
  const [rangeTo, setRangeTo] = useState(activeType === 'Custom Range' ? initialTo : '');

  useEffect(() => {
    if (isOpen) {
      setSelectedType(activeType);
      if (activeType === 'Specific Day') setSpecificDay(initialFrom);
      if (activeType === 'Custom Range') {
        setRangeFrom(initialFrom);
        setRangeTo(initialTo);
      }
    }
  }, [isOpen, activeType, initialFrom, initialTo]);

  if (!isOpen) return null;

  const todayYmd = new Date().toISOString().slice(0, 10);

  const handleSelectPreset = (preset: DateFilterType) => {
    setSelectedType(preset);
    const res = computeDateRange(preset);
    if (res) {
      onSelect(res);
      onClose();
    }
  };

  const handleSelectSpecificDay = (ymd: string) => {
    setSpecificDay(ymd);
    setSelectedType('Specific Day');
    if (ymd) {
      const res = computeDateRange('Specific Day', ymd);
      if (res) {
        onSelect(res);
        onClose();
      }
    }
  };

  const handleApplyCustomRange = () => {
    if (!rangeFrom || !rangeTo) return;
    const res = computeDateRange('Custom Range', undefined, rangeFrom, rangeTo);
    if (res) {
      setSelectedType('Custom Range');
      onSelect(res);
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 12, 4, 0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--pay-background, #FBF7F0)',
          width: '100%',
          maxWidth: 400,
          borderRadius: 24,
          padding: '24px 20px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.22)',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, fontWeight: 700, color: 'var(--pay-text)' }}>
            Select Date
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              padding: 6,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--pay-text)',
              borderRadius: 8,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 6 Preset Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 22 }}>
          {ALL_PRESETS.map((p) => {
            const isActive = selectedType === p;
            return (
              <button
                key={p}
                onClick={() => handleSelectPreset(p)}
                style={{
                  height: 52,
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  border: isActive ? 'none' : '1px solid var(--pay-border, #E9DAC4)',
                  background: isActive
                    ? 'linear-gradient(135deg, var(--pay-primary, #C58A2E), var(--pay-primary-dark, #8B5A18))'
                    : 'var(--pay-surface, #FFFFFF)',
                  color: isActive ? '#FFFFFF' : 'var(--pay-text, #2C2118)',
                  boxShadow: isActive ? '0 4px 12px rgba(197, 138, 46, 0.25)' : '0 1px 3px rgba(0, 0, 0, 0.02)',
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Specific Day */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pay-text-secondary, #6D5F50)', marginBottom: 8 }}>
          Specific Day
        </div>
        <div style={{ marginBottom: 22 }}>
          <input
            type="date"
            className="pay-date-input"
            value={selectedType === 'Specific Day' ? specificDay : ''}
            max={todayYmd}
            onChange={(e) => handleSelectSpecificDay(e.target.value)}
          />
        </div>

        {/* Custom Range */}
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pay-text-secondary, #6D5F50)', marginBottom: 8 }}>
          Custom Range
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="date"
            className="pay-date-input"
            style={{ flex: 1, minWidth: 0 }}
            value={rangeFrom}
            max={todayYmd}
            onChange={(e) => {
              setRangeFrom(e.target.value);
              setSelectedType('Custom Range');
            }}
          />
          <span style={{ color: 'var(--pay-text-muted, #9B8B78)', fontWeight: 700, fontSize: 16 }}>–</span>
          <input
            type="date"
            className="pay-date-input"
            style={{ flex: 1, minWidth: 0 }}
            value={rangeTo}
            max={todayYmd}
            onChange={(e) => {
              setRangeTo(e.target.value);
              setSelectedType('Custom Range');
            }}
          />
        </div>

        {/* Apply Range button */}
        {rangeFrom && rangeTo && (
          <button
            className="pay-btn"
            style={{ width: '100%', marginTop: 22, height: 50, minHeight: 50, fontSize: 15 }}
            onClick={handleApplyCustomRange}
          >
            Apply Range
          </button>
        )}
      </div>
    </div>
  );
}
