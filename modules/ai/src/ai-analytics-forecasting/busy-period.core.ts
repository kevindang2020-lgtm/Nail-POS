// busy-period.core.ts — classifies each hour-of-week cell as very slow → very busy relative to the branch's own average
// booked demand for that hour. Operates on already-normalized cells (average appointments per occurrence of that weekday-
// hour) so it's pure and testable. Confidence degrades with thin history. This describes historical intensity for staffing
// and walk-in planning — it is decision-support, not a guarantee, and drives no automatic action.
export type BusyLevel = 'very_slow' | 'slow' | 'normal' | 'busy' | 'very_busy';
export type BusyConfidence = 'high' | 'moderate' | 'low' | 'insufficient_data';

export interface HourCellInput { dow: number; hour: number; avg: number; samples: number; occurrences: number }
export interface HourCell {
  dow: number; hour: number; avg: number; ratio: number; level: BusyLevel; samples: number; reason: string;
}
export interface BusyPeriodResult {
  cells: HourCell[];
  branchHourlyMean: number;
  peak: HourCell | null;
  slowest: HourCell | null;
  confidence: BusyConfidence;
  populatedCells: number;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const hourLabel = (h: number) => { const am = h < 12; const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${am ? 'am' : 'pm'}`; };

function levelFor(ratio: number): BusyLevel {
  if (ratio >= 1.5) return 'very_busy';
  if (ratio >= 1.15) return 'busy';
  if (ratio >= 0.6) return 'normal';
  if (ratio >= 0.3) return 'slow';
  return 'very_slow';
}

export function classifyBusyPeriods(input: HourCellInput[]): BusyPeriodResult {
  const populated = input.filter((c) => c.avg > 0);
  if (populated.length === 0) {
    return { cells: [], branchHourlyMean: 0, peak: null, slowest: null, confidence: 'insufficient_data', populatedCells: 0 };
  }
  const mean = populated.reduce((a, c) => a + c.avg, 0) / populated.length;
  const cells: HourCell[] = populated
    .map((c) => {
      const ratio = mean > 0 ? round2(c.avg / mean) : 0;
      const level = levelFor(ratio);
      return {
        dow: c.dow, hour: c.hour, avg: round2(c.avg), ratio, level, samples: c.samples,
        reason: `${DOW[c.dow]} ${hourLabel(c.hour)}: ~${round2(c.avg)} booking(s)/occurrence vs branch average ${round2(mean)} (${Math.round(ratio * 100)}%).`,
      };
    })
    .sort((a, b) => a.dow - b.dow || a.hour - b.hour);

  const peak = cells.reduce((a, b) => (b.avg > a.avg ? b : a));
  const slowest = cells.reduce((a, b) => (b.avg < a.avg ? b : a));

  const minOcc = Math.min(...populated.map((c) => c.occurrences));
  let confidence: BusyConfidence;
  if (populated.length < 5 || minOcc < 2) confidence = 'insufficient_data';
  else if (minOcc >= 8 && populated.length >= 15) confidence = 'high';
  else if (minOcc >= 4) confidence = 'moderate';
  else confidence = 'low';

  return { cells, branchHourlyMean: round2(mean), peak, slowest, confidence, populatedCells: populated.length };
}
