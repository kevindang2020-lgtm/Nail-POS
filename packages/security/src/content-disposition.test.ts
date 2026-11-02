import { describe, it, expect } from 'vitest';
import { contentDisposition } from './content-disposition';
describe('contentDisposition (D10)', () => {
  it('a quote, path or control character cannot break out of the parameter', () => {
    const h = contentDisposition('report"; filename=evil.exe\r\nX-Injected: 1.csv');
    expect(h.startsWith('attachment; filename="')).toBe(true);
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split('"').length).toBe(3);   // exactly one quoted filename
    expect(contentDisposition('../../etc/passwd')).toContain('filename="passwd"');
    expect(contentDisposition('Báo cáo.csv')).toContain("filename*=UTF-8''B%C3%A1o%20c%C3%A1o.csv");
  });
});
