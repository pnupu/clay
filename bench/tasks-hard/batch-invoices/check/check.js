// Hidden check: batch output must equal the known-good invoices, also when run twice in one process.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const work = process.argv[2];
for (const f of ['customers.json', 'rates.json', 'orders.json']) fs.copyFileSync(path.join(__dirname, 'data', f), path.join(work, 'data', f));
const fail = (why) => { console.log('FAIL wrong-output: ' + why); process.exit(1); };
const script = `
const { generateBatch, generateInvoice } = require(${JSON.stringify(path.join(work, 'src', 'index.js'))});
const orders = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(__dirname, 'batch.json'))}, 'utf8'));
const a = generateBatch(orders), b = generateBatch(orders.slice().reverse()).reverse();
const c = orders.map((o) => generateInvoice(o));
const pick = (i) => ({ number: i.number, currency: i.currency, rate: i.rate, net: i.netCents, vat: i.vatCents, total: i.totalCents, due: i.dueDate });
console.log(JSON.stringify({ a: a.map(pick), b: b.map(pick), c: c.map(pick) }));`;
const r = cp.spawnSync('node', ['-e', script], { cwd: work, encoding: 'utf8', timeout: 30000 });
if (r.status !== 0) fail('batch crashed: ' + r.stderr.slice(-300));
const got = JSON.parse(r.stdout);
const want = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
for (const k of ['a', 'b', 'c']) {
  for (let i = 0; i < want.length; i++) {
    if (JSON.stringify(got[k][i]) !== JSON.stringify(want[i])) fail(`${k === 'a' ? 'batch' : k === 'b' ? 'reversed batch' : 'one by one'} invoice ${want[i].number}: got ${JSON.stringify(got[k][i])}, want ${JSON.stringify(want[i])}`);
  }
}
const cli = cp.spawnSync('node', ['src/cli.js', 'data/orders.json'], { cwd: work, encoding: 'utf8', timeout: 30000 });
if (cli.stdout !== fs.readFileSync(path.join(__dirname, 'cli-expected.txt'), 'utf8')) fail('cli output differs: ' + JSON.stringify(cli.stdout.slice(0, 300)));
const t = cp.spawnSync('node', ['test/run.js'], { cwd: work, encoding: 'utf8', timeout: 30000 });
if (t.status !== 0) { console.log('FAIL broke-behaviour: test/run.js fails'); process.exit(1); }
console.log('pass');
