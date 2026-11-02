// content-disposition.ts — Security Deep Scan D10 (§99): ONE Content-Disposition builder. Filenames built from query
// values (report date ranges) or stored names were interpolated raw into `filename="…"` — a `"` broke out of the
// parameter. RFC 6266: an ASCII-safe `filename` plus the exact name as `filename*` (UTF-8, percent-encoded).
export function contentDisposition(name: string, kind: 'attachment' | 'inline' = 'attachment'): string {
  const base = String(name ?? '').replace(/[\r\n\0]/g, '').replace(/^.*[\\/]/, '').trim() || 'download';
  const ascii = base.replace(/[^A-Za-z0-9._ ()+-]/g, '_').slice(0, 150) || 'download';
  const utf8 = encodeURIComponent(base.slice(0, 200)).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
