// 200-technician mandate §4/§82/§94 (Oct 23 2026): the board's page math, shared by the server and the POS.
import { describe, it, expect } from 'vitest';
import { bookingTechPageMath, bookingTechPageOf, BOOKING_TECH_PAGE_SIZE } from './booking';

describe('bookingTechPageMath — 12 technicians a page', () => {
  it('200 technicians are 17 pages: page 1 = #1–12, page 8 = #85–96, page 16 = #181–192, page 17 = #193–200', () => {
    expect(BOOKING_TECH_PAGE_SIZE).toBe(12);
    expect(bookingTechPageMath(200, 12, 1)).toMatchObject({ totalPages: 17, first: 1, last: 12 });
    expect(bookingTechPageMath(200, 12, 8)).toMatchObject({ totalPages: 17, first: 85, last: 96 });
    expect(bookingTechPageMath(200, 12, 16)).toMatchObject({ first: 181, last: 192 });
    expect(bookingTechPageMath(200, 12, 17)).toMatchObject({ first: 193, last: 200, startIndex: 192, endIndex: 200 });
  });
  it('the edge totals 0, 1, 11, 12, 13, 24, 25, 199, 200, 201', () => {
    const pages = (n: number) => bookingTechPageMath(n, 12, 1).totalPages;
    expect([0, 1, 11, 12, 13, 24, 25, 199, 200, 201].map(pages)).toEqual([1, 1, 1, 1, 2, 2, 3, 17, 17, 17]);
    expect(bookingTechPageMath(201, 12, 17)).toMatchObject({ totalPages: 17, first: 193, last: 201 });
    expect(bookingTechPageMath(0, 12, 1)).toMatchObject({ first: 0, last: 0, startIndex: 0, endIndex: 0 });
    expect(bookingTechPageMath(13, 12, 2)).toMatchObject({ first: 13, last: 13 });
    expect(bookingTechPageMath(25, 12, 3)).toMatchObject({ first: 25, last: 25 });
    expect(bookingTechPageMath(164, 12, 1).totalPages).toBe(14);   // §10: 164 working = 14 pages
  });
  it('a page past the end clamps to the last page; a nonsense page is page 1', () => {
    expect(bookingTechPageMath(200, 12, 99).page).toBe(17);
    expect(bookingTechPageMath(200, 12, 0).page).toBe(1);
    expect(bookingTechPageMath(200, 12, NaN).page).toBe(1);
  });
  it('the page holding a roster index', () => {
    expect(bookingTechPageOf(0, 12)).toBe(1);
    expect(bookingTechPageOf(11, 12)).toBe(1);
    expect(bookingTechPageOf(12, 12)).toBe(2);
    expect(bookingTechPageOf(199, 12)).toBe(17);
  });
});
