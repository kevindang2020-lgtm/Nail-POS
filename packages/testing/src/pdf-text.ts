// @aipowersalon/testing/pdf-text — the typed entry of pdf-text.mjs (the reader itself is plain .mjs so the live pilot
// scripts under apps/api/scripts import the very same code). Test-only, like the rest of this package.
// @ts-expect-error — a plain .mjs module without a declaration file; its two functions are typed here
import * as reader from './pdf-text.mjs';

/** The text of every page of a pdfkit PDF: one line per BT…ET block, pages separated by "\f". */
export const pdfText: (pdf: Uint8Array) => string = reader.pdfText;
/** How many pages the PDF has. */
export const pdfPageCount: (pdf: Uint8Array) => number = reader.pdfPageCount;
