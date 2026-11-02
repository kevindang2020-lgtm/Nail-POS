// pdf-text.mjs — read the TEXT back out of a PDF the API generated (pdfkit), so a test can assert what a person sees on
// the page — the Vietnamese diacritics included — instead of trusting the data that went in (Weekly Paycheck 17.5, the
// pay-stub PDF, Oct 27 2026). No dependency: the streams are inflated with node:zlib, each embedded font's ToUnicode CMap
// maps its glyph codes back to Unicode, and the page content streams are walked for Tj / TJ.
//
// Scope: what pdfkit writes — FlateDecode streams, Identity-H fonts with a ToUnicode CMap (2-byte codes), the standard
// 14 fonts as WinAnsi literal strings. Each BT … ET block becomes one line, in page order (pdfkit writes one block per
// text() call), pages joined by a form feed. It is a test reader, not a general PDF parser.
import { inflateSync } from 'node:zlib';

/** @param {Buffer | Uint8Array} pdf @returns {{ objects: Map<number, { dict: string, stream: Buffer | null }> }} */
function objectsOf(pdf) {
  const src = Buffer.from(pdf).toString('latin1');
  const objects = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const end = src.indexOf('endobj', start);
    if (end < 0) break;
    const body = src.slice(start, end);
    const si = body.indexOf('stream');
    let dict = body, stream = null;
    if (si >= 0 && /\/Length\s+\d+/.test(body.slice(0, si))) {
      dict = body.slice(0, si);
      let from = si + 'stream'.length;
      if (body[from] === '\r') from++;
      if (body[from] === '\n') from++;
      const len = Number(/\/Length\s+(\d+)/.exec(dict)[1]);
      let raw = Buffer.from(body.slice(from, from + len), 'latin1');
      if (/\/FlateDecode/.test(dict)) raw = inflateSync(raw);
      stream = raw;
    }
    objects.set(Number(m[1]), { dict, stream });
    re.lastIndex = end;
  }
  return { objects };
}

const hexToBuf = (h) => Buffer.from(h.replace(/\s+/g, '').padEnd(Math.ceil(h.replace(/\s+/g, '').length / 2) * 2, '0'), 'hex');
const utf16 = (h) => { const b = hexToBuf(h); let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i)); return s; };

/** a ToUnicode CMap → Map<code, string> (bfchar + bfrange, both forms) */
function cmapOf(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]+)>/g)) map.set(parseInt(p[1], 16), utf16(p[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // a destination may hold several code units with a space between them (pdfkit writes the "fi" ligature as <0066 0069>)
    for (const p of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f\s]+>)/g)) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16);
      if (p[3].startsWith('[')) { const xs = [...p[3].matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((x) => utf16(x[1])); for (let c = lo; c <= hi; c++) map.set(c, xs[c - lo] ?? ''); }
      else { const base = utf16(p[3].slice(1, -1)); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
    }
  }
  return map;
}

const ref = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict); return m ? Number(m[1]) : null; };
const unescapeLiteral = (s) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' })[e] ?? String.fromCharCode(parseInt(e, 8)));

/**
 * The text of every page of a pdfkit PDF: one line per BT…ET block, pages separated by "\f".
 * @param {Buffer | Uint8Array} pdf
 * @returns {string}
 */
export function pdfText(pdf) {
  const { objects } = objectsOf(pdf);
  const get = (n) => objects.get(n);
  // font resource name → decoder, from every /Font << /Fx n 0 R >> resource dictionary
  const fonts = new Map();
  for (const { dict } of objects.values()) {
    const res = /\/Font\s*<<([\s\S]*?)>>/.exec(dict);
    if (!res) continue;
    for (const f of res[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      if (fonts.has(f[1])) continue;
      const font = get(Number(f[2]));
      const tu = font ? ref(font.dict, 'ToUnicode') : null;
      const cmap = tu != null && get(tu)?.stream ? cmapOf(get(tu).stream.toString('latin1')) : null;
      fonts.set(f[1], cmap);
    }
  }
  // pages in /Kids order (the root /Pages object), each page's /Contents stream
  const pagesObj = [...objects.values()].find((o) => /\/Type\s*\/Pages\b/.test(o.dict));
  const kids = pagesObj ? [...(/\/Kids\s*\[([^\]]*)\]/.exec(pagesObj.dict)?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)].map((k) => Number(k[1])) : [];
  const pages = [];
  for (const k of kids) {
    const page = get(k); if (!page) continue;
    const c = ref(page.dict, 'Contents');
    const content = c != null ? get(c)?.stream?.toString('latin1') ?? '' : '';
    const lines = [];
    let cur = null, line = '';
    const decodeHex = (h) => {
      const b = hexToBuf(h);
      if (!cur) return b.toString('latin1');
      let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += cur.get(b.readUInt16BE(i)) ?? '';
      return s;
    };
    const tok = /\/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ|\bBT\b|\bET\b/g;
    let t;
    while ((t = tok.exec(content))) {
      if (t[0] === 'BT') { line = ''; continue; }
      if (t[0] === 'ET') { if (line.trim()) lines.push(line); line = ''; continue; }
      if (t[1]) { cur = fonts.get(t[1]) ?? null; continue; }
      if (t[2] !== undefined) { line += decodeHex(t[2]); continue; }
      if (t[3] !== undefined) { line += unescapeLiteral(t[3]); continue; }
      if (t[4] !== undefined) {
        for (const part of t[4].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)|(-?[\d.]+)/g)) {
          if (part[1] !== undefined) line += decodeHex(part[1]);
          else if (part[2] !== undefined) line += unescapeLiteral(part[2]);
          else if (Number(part[3]) < -200) line += ' ';   // a wide negative kern is a word gap
        }
      }
    }
    pages.push(lines.join('\n'));
  }
  return pages.join('\f');
}

/** How many pages the PDF has (its /Pages /Count). */
export function pdfPageCount(pdf) {
  const m = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(Buffer.from(pdf).toString('latin1'));
  return m ? Number(m[1]) : 0;
}
