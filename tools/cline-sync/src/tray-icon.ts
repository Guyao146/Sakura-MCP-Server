/**
 * Tray icon assets, embedded as base64 data URIs so the packaged tool needs no
 * external image files. A 16x16 RGBA dot in the Sakura accent colour: `.ico`
 * (PNG-encoded, which Windows Vista+ accepts) for Windows and `.png` elsewhere.
 */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGJTgadfi/9gw2RqJNogiA4jVjNOQUQOoYMDApwNiDCKocUAAAHI6fEzvo7d9AAAAAElFTkSuQmCC';
const ICO_BASE64 = 'AAABAAEAEBAAAAEAIABmAAAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAC1JREFUeJxjYBiU4GnX4v/YMNkaiTaIIgOI1YzTkFEDqGDAwKcDYgwiqHFAAAByOnxM76O3fQAAAABJRU5ErkJggg==';

export const trayIconPng = `data:image/png;base64,${PNG_BASE64}`;
export const trayIconIco = `data:image/x-icon;base64,${ICO_BASE64}`;
