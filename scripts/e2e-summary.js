const fs = require('node:fs');
const path = require('node:path');

const LOG_PATH = path.join(process.cwd(), 'logs', 'e2e-log.jsonl');

function hhmmss(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.log(`No log file at ${LOG_PATH}`);
    console.log('Run the app in dev mode (npm run dev), perform the E2E steps, then re-run this script.');
    process.exit(1);
  }

  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      console.warn('Skipping malformed line:', line.slice(0, 120));
    }
  }

  const first = events[0];
  const last = events[events.length - 1];
  const durationMs = last && first ? new Date(last.ts).getTime() - new Date(first.ts).getTime() : 0;

  console.log(`E2E log: ${events.length} events over ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`File: ${LOG_PATH}`);
  if (first) console.log(`Session: ${first.version || '?'} ${first.platform || ''} ${first.arch || ''} @ ${first.ts}`);
  console.log();

  const counts = {};
  for (const e of events) counts[e.event] = (counts[e.event] || 0) + 1;
  const eventNames = Object.keys(counts).sort();
  console.log('Event counts:');
  for (const name of eventNames) console.log(`  ${name}: ${counts[name]}`);
  console.log();

  console.log('Timeline:');
  for (const e of events) {
    const fields = Object.entries(e)
      .filter(([k]) => !['ts', 'event', 'stack'].includes(k))
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    const marker = e.event.includes('.error') || e.error ? '  !!' : '   ';
    console.log(`${marker} ${hhmmss(e.ts)} ${e.event}${fields ? ` ${fields}` : ''}`);
  }

  const errors = events.filter(e => e.event.includes('.error') || e.error);
  console.log();
  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  [${hhmmss(e.ts)}] ${e.event}: ${e.error || '(error flag)'}`);
      if (e.stack) console.log(`    ${e.stack.split('\n').slice(0, 3).join('\n    ')}`);
    }
  } else {
    console.log('No errors recorded.');
  }
}

main();
