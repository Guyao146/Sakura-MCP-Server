import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPackaged, prepareTrayBinary, trayBinaryName } from '../src/tray-binary.js';

describe('packaged tray helper', () => {
  it('maps each platform to its helper binary name', () => {
    expect(trayBinaryName('win32')).toBe('tray_windows_release.exe');
    expect(trayBinaryName('darwin')).toBe('tray_darwin_release');
    expect(trayBinaryName('linux')).toBe('tray_linux_release');
    expect(trayBinaryName('aix')).toBeUndefined();
  });

  it('detects a packaged build from argv and the pkg marker', () => {
    // Running via `node script.js`: argv[1] differs from execPath.
    expect(isPackaged(['/usr/bin/node', '/app/dist/main.js'], '/usr/bin/node')).toBe(false);
    // A single-file executable runs itself.
    expect(isPackaged(['/app/cline-sync.exe', '/app/cline-sync.exe'], '/app/cline-sync.exe')).toBe(true);
  });

  it('does nothing when running from source', async () => {
    await expect(prepareTrayBinary({ packaged: false })).resolves.toBeUndefined();
  });

  it('copies the helper out of the snapshot exactly once', async () => {
    const target = await mkdtemp(join(tmpdir(), 'tray-bin-'));
    const first = await prepareTrayBinary({ packaged: true, platform: 'win32', targetDir: target });
    expect(first).toBe(target);
    const copied = join(target, 'traybin', 'tray_windows_release.exe');
    const info = await stat(copied);
    expect(info.size).toBeGreaterThan(0);

    // A second call must be a no-op rather than copying again.
    const second = await prepareTrayBinary({ packaged: true, platform: 'win32', targetDir: target });
    expect(second).toBe(target);
    expect((await stat(copied)).size).toBe(info.size);
  });

  it('reports a clear error for a platform with no bundled helper', async () => {
    const target = await mkdtemp(join(tmpdir(), 'tray-bin-none-'));
    await expect(prepareTrayBinary({ packaged: true, platform: 'aix', targetDir: target })).resolves.toBeUndefined();
  });
});
