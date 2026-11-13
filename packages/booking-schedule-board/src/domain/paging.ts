/** Technician paging (spec §9). Pure; the UI and tests share it. */
export const DEFAULT_PER_PAGE = 12;
export const PER_PAGE_OPTIONS = [6, 8, 10, 12, 16] as const;

export interface PageInfo {
  /** 0-based page index, clamped to the valid range. */
  pageIndex: number;
  pageCount: number;
  perPage: number;
  total: number;
  /** 0-based inclusive start / exclusive end of the visible slice. */
  startIndex: number;
  endIndex: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** `Technicians 1–12 of 24` (or `No technicians`). */
  label: string;
  /** `Next 12` / `Next 3` (the size of the following page). */
  nextLabel: string;
}

export function pageInfo(total: number, perPage: number, requestedPage: number): PageInfo {
  const safePer = Math.max(1, Math.floor(perPage));
  const pageCount = Math.max(1, Math.ceil(total / safePer));
  const pageIndex = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1);
  const startIndex = Math.min(total, pageIndex * safePer);
  const endIndex = Math.min(total, startIndex + safePer);
  const nextCount = Math.min(safePer, Math.max(0, total - endIndex));
  return {
    pageIndex,
    pageCount,
    perPage: safePer,
    total,
    startIndex,
    endIndex,
    hasPrevious: pageIndex > 0,
    hasNext: endIndex < total,
    label: total === 0 ? 'No technicians' : `Technicians ${startIndex + 1}–${endIndex} of ${total}`,
    nextLabel: `Next ${nextCount || safePer}`,
  };
}

/** Which page a technician sits on (for "restore selected technician"). */
export function pageOfIndex(index: number, perPage: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, perPage));
}
