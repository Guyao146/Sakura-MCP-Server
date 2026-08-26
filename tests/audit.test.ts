import { describe, expect, it } from 'vitest';
import { sanitize } from '../src/audit.js';

describe('audit metadata sanitization', () => {
  it('redacts secrets and large memory bodies recursively', () => {
    const sanitized = sanitize({ apiKey: 'secret-key', nested: { authorization: 'Bearer token', safe: 'visible' },
      content: 'private memory', note: 'x'.repeat(600), list: [{ password: 'hidden' }] }) as Record<string, unknown>;
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.content).toBe('[REDACTED]');
    expect(sanitized.nested).toEqual({ authorization: '[REDACTED]', safe: 'visible' });
    expect(String(sanitized.note)).toContain('[TRUNCATED]');
    expect(sanitized.list).toEqual([{ password: '[REDACTED]' }]);
  });

  it('limits recursion and array size', () => {
    expect((sanitize(Array.from({ length: 150 }, (_, index) => index)) as unknown[])).toHaveLength(100);
    expect(JSON.stringify(sanitize({ a: { b: { c: { d: { e: { f: { g: { h: 'deep' } } } } } } } }))).toContain('[TRUNCATED]');
  });
});