import { describe, expect, it } from 'vitest';
import { resolveSysTray } from '../src/systray-interop.js';

class FakeSysTray {}

describe('systray interop', () => {
  it('unwraps the constructor from every CJS/ESM interop shape', () => {
    // Node's ESM loader nests the namespace: { default: { default: Class } }.
    expect(resolveSysTray({ default: { default: FakeSysTray } })).toBe(FakeSysTray);
    expect(resolveSysTray({ default: FakeSysTray })).toBe(FakeSysTray);
    expect(resolveSysTray(FakeSysTray)).toBe(FakeSysTray);
  });

  it('fails loudly when no constructor is present so the caller can fall back', () => {
    expect(() => resolveSysTray({ default: { notAClass: 1 } })).toThrow('未导出可用的构造函数');
    expect(() => resolveSysTray(undefined)).toThrow('未导出可用的构造函数');
  });
});
