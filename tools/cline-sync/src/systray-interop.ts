/**
 * Unwraps the systray2 constructor across interop shapes. Node's ESM loader
 * wraps this CommonJS package so that `default` is the module namespace object
 * (`{ default: SysTray, ... }`) rather than the class itself, which made a naive
 * `module.default` a plain object and broke `new SysTray(...)`. Walk down until
 * a constructor appears.
 *
 * Lives in its own module so tests can import it without booting the daemon.
 */
export function resolveSysTray(imported: unknown): typeof import('systray2').default {
  const candidates = [
    imported,
    (imported as { default?: unknown })?.default,
    ((imported as { default?: { default?: unknown } })?.default)?.default
  ];
  const found = candidates.find(candidate => typeof candidate === 'function');
  if (!found) throw new Error('systray2 未导出可用的构造函数');
  return found as typeof import('systray2').default;
}
