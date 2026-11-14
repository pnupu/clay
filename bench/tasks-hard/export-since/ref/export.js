const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('./lib/args');
const { parseDay, dayStartUtc, formatLocal } = require('./lib/days');

function main(argv) {
  const opts = parseArgs(argv);
  const { timezone_offset_minutes: tz } = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  let entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'entries.json'), 'utf8'))
    .map((e) => ({ ...e, ms: Date.parse(e.ts) }))
    .sort((a, b) => a.ms - b.ms);
  if (opts.user) entries = entries.filter((e) => e.user === opts.user);
  if (opts.since !== undefined) {
    const day = parseDay(opts.since);
    if (!day) {
      process.stderr.write(`invalid date: ${opts.since}\n`);
      process.exit(2);
    }
    const start = dayStartUtc(day, tz);
    entries = entries.filter((e) => e.ms >= start);
  }
  if (opts.until !== undefined) {
    const day = parseDay(opts.until);
    if (!day) {
      process.stderr.write(`invalid date: ${opts.until}\n`);
      process.exit(2);
    }
    const end = dayStartUtc({ ...day, d: day.d + 1 }, tz);
    entries = entries.filter((e) => e.ms < end);
  }
  const lines = ['time,user,action', ...entries.map((e) => `${formatLocal(e.ms, tz)},${e.user},${e.action}`)];
  process.stdout.write(lines.join('\n') + '\n');
}

main(process.argv.slice(2));
