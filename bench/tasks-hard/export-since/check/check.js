const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const work = process.argv[2];
const files = ['config.json', 'entries.json'].map((f) => path.join(work, f));
const saved = files.map((f) => fs.readFileSync(f));
const restore = () => files.forEach((f, i) => fs.writeFileSync(f, saved[i]));
const fail = (kind, why) => { restore(); console.log(`FAIL ${kind}: ${why}`); process.exit(1); };
const entries = [
  { ts: '2026-03-01T04:59:00Z', user: 'u1', action: 'a1' },
  { ts: '2026-03-01T05:00:00Z', user: 'u2', action: 'a2' },
  { ts: '2026-02-28T21:59:59Z', user: 'u1', action: 'a0' },
  { ts: '2026-03-02T04:59:00Z', user: 'u2', action: 'a3' },
  { ts: '2026-03-02T05:00:00Z', user: 'u1', action: 'a4' },
  { ts: '2026-03-01T12:00:00Z', user: 'u1', action: 'a5' },
];
function run(tz, ...args) {
  fs.writeFileSync(files[0], JSON.stringify({ timezone_offset_minutes: tz }));
  fs.writeFileSync(files[1], JSON.stringify(entries));
  return cp.spawnSync('node', ['export.js', ...args], { cwd: work, encoding: 'utf8', timeout: 20000 });
}
const actions = (r) => r.stdout.trim().split('\n').slice(1).map((l) => l.split(',')[2]).join(' ');
try {
  // Account 5 hours west of UTC: 2026-03-01 starts at 05:00Z.
  let r = run(-300, '--since', '2026-03-01');
  if (r.status !== 0) fail('wrong-output', `--since exited ${r.status}: ${r.stderr.slice(0, 200)}`);
  if (actions(r) !== 'a2 a5 a3 a4') fail('wrong-output', `--since 2026-03-01 with offset -300 gave [${actions(r)}], want [a2 a5 a3 a4] (day starts in the account time zone)`);
  r = run(-300, '--since', '2026-03-01', '--until', '2026-03-01');
  if (actions(r) !== 'a2 a5 a3') fail('wrong-output', `--since and --until on the same day gave [${actions(r)}], want [a2 a5 a3]`);
  r = run(-300, '--until', '2026-03-01', '--since', '2026-03-01', '--user', 'u1');
  if (actions(r) !== 'a5') fail('wrong-output', `--since with --until and --user gave [${actions(r)}], want [a5]`);
  r = run(120, '--since', '2026-03-01');
  if (actions(r) !== 'a1 a2 a5 a3 a4') fail('wrong-output', `--since 2026-03-01 with offset 120 gave [${actions(r)}], want [a1 a2 a5 a3 a4]`);
  r = run(120, '--since', '2026-02-29');
  if (r.status !== 2 || r.stderr !== 'invalid date: 2026-02-29\n') fail('wrong-output', `--since 2026-02-29 should print "invalid date: 2026-02-29" and exit 2, got status ${r.status}, stderr ${JSON.stringify(r.stderr)}`);
  r = run(120, '--since', '1.3.2026');
  if (r.status !== 2) fail('wrong-output', '--since 1.3.2026 should exit 2');
  r = run(120, '--until', '2026-03-01');
  if (actions(r) !== 'a0 a1 a2 a5') fail('broke-behaviour', `--until changed: [${actions(r)}]`);
  r = run(120);
  if (r.stdout.trim().split('\n')[1] !== '2026-02-28 23:59,u1,a0') fail('broke-behaviour', `output format changed: ${r.stdout.split('\n')[1]}`);
} finally {
  restore();
}
const t = cp.spawnSync('node', ['test/run.js'], { cwd: work, encoding: 'utf8', timeout: 30000 });
if (t.status !== 0) fail('broke-behaviour', 'test/run.js fails: ' + t.stderr.slice(-300));
console.log('pass');
