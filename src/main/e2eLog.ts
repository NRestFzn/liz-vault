import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const LOG_DIR = 'logs';
const LOG_FILE = 'e2e-log.jsonl';
const MAX_LOG_BYTES = 50 * 1024 * 1024;

let logPath: string | null = null;

export function initE2ELog(): void {
  if (app.isPackaged) return;
  const dir = path.join(process.cwd(), LOG_DIR);
  fs.mkdirSync(dir, { recursive: true });
  logPath = path.join(dir, LOG_FILE);
  logE2E('session.start', { version: app.getVersion(), platform: process.platform, arch: process.arch });
}

export function logE2E(event: string, data: Record<string, unknown> = {}): void {
  if (!logPath) return;
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
      fs.rmSync(logPath);
    }
    const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
  }
}

export function logE2EError(event: string, error: unknown, data: Record<string, unknown> = {}): void {
  logE2E(event, {
    ...data,
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
}
