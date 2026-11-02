import { describe, it, expect } from 'vitest';
import { extractPlaceholders, validateTemplate, renderPreview } from './communications-templates-core';

describe('communications templates core', () => {
  it('extracts distinct placeholders', () => {
    expect(extractPlaceholders('Hi {{name}}, your {{service}} with {{name}} is set').sort()).toEqual(['name', 'service']);
    expect(extractPlaceholders('no tokens here')).toEqual([]);
  });

  it('validates safe placeholders and rejects injection', () => {
    expect(validateTemplate('Hi {{first_name}}')).toMatchObject({ ok: true, placeholders: ['first_name'] });
    expect(validateTemplate('Hi {{ bad-name }}').ok).toBe(false);
    expect(validateTemplate('Broken {{name').ok).toBe(false);
    expect(validateTemplate('Danger {% for x %}').ok).toBe(false);
    expect(validateTemplate('Danger ${code}').ok).toBe(false);
  });

  it('renders a safe preview escaping untrusted values', () => {
    expect(renderPreview('Hi {{name}}', { name: 'Alice' })).toBe('Hi Alice');
    expect(renderPreview('Hi {{name}}', { name: '<script>x</script>' })).toBe('Hi &lt;script&gt;x&lt;/script&gt;');
    expect(renderPreview('Hi {{name}}', {})).toBe('Hi [name]');
  });
});
