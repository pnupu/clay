const assert = require('node:assert');
const cp = require('node:child_process');
const path = require('node:path');
const run = (...a) => cp.spawnSync('node', [path.join(__dirname, '..', 'export.js'), ...a], { encoding: 'utf8' });

let r = run('--until', '2026-02-28');
assert.strictEqual(r.status, 0);
assert.deepStrictEqual(r.stdout.trim().split('\n'), ['time,user,action', '2026-02-27 10:15,aino,login', '2026-02-28 23:40,aino,export']);
r = run('--until', '2026-02-30');
assert.strictEqual(r.status, 2);
assert.strictEqual(r.stderr, 'invalid date: 2026-02-30\n');
r = run('--user', 'veikko');
assert.strictEqual(r.stdout.trim().split('\n').length, 3);
console.log('ok');
