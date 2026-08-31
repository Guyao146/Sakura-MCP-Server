#!/usr/bin/env node
/**
 * One-shot CLI: run a single sync pass and print a summary. Useful for cron,
 * testing, or a manual flush without the tray. Reads the same config.json the
 * tray app uses.
 */
import { loadConfig } from './store.js';
import { validateConfig } from './config.js';
import { runSync } from './sync.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const problems = validateConfig(config);
  if (problems.length) {
    console.error('配置无效：', problems.join(' '));
    console.error('请先运行托盘程序并在配置面板中填写 MCP 地址与 Agent 密钥。');
    process.exit(1);
  }
  const summary = await runSync(config, { logger: message => console.log(`[sync] ${message}`) });
  console.log(`\n完成：扫描 ${summary.scanned} · 同步 ${summary.synced} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`);
  process.exit(summary.failed > 0 ? 2 : 0);
}

void main().catch(error => {
  console.error('同步出错：', error instanceof Error ? error.message : error);
  process.exit(1);
});
