const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const work = process.argv[2];
// The instruction does not say where rates.json lives, so the check puts the data files in the work
// directory itself (next to totals.js, in the working directory, and next to the CSV at once) and
// restores the originals afterwards.
function run(csvText, rates) {
  const files = ['orders.csv', 'rates.json'].map(n => path.join(work, n));
  const saved = files.map(f => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  try {
    fs.writeFileSync(files[0], csvText);
    fs.writeFileSync(files[1], JSON.stringify(rates));
    const r = cp.spawnSync('node', ['totals.js', 'orders.csv'], { cwd: work, encoding: 'utf8', timeout: 30000 });
    return JSON.parse(r.stdout);
  } finally {
    files.forEach((f, i) => (saved[i] === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, saved[i])));
  }
}
const assert = require('node:assert');
const sample = fs.readFileSync(path.join(__dirname, 'orders.csv'), 'utf8');
let got = run(sample, { EUR: 1, USD: 0.9, GBP: 1.2 });
assert.deepStrictEqual(got, { 'ACME, Inc.': 100, Bob: 28.45, Zed: 8.52 });
assert.deepStrictEqual(Object.keys(got), ['ACME, Inc.', 'Bob', 'Zed']);
const hidden = 'order_id,customer,amount,currency,status\r\n' +
  '1,"Bob ""The Builder"" Ltd",10.10,EUR,paid\r\n' +
  '2,"Smith, Jones & Co",0.10,USD,paid\r\n' +
  '3,"Smith, Jones & Co",0.20,USD,paid\r\n' +
  '4,Alpha,99,EUR,pending\r\n' +
  '5,"Bob ""The Builder"" Ltd","1,000.00",EUR,refunded\r\n' +
  '6,Delta,3.333,EUR,paid\r\n' +
  '7,Alpha,1.005,SEK,paid\r\n\r\n';
got = run(hidden, { EUR: 1, USD: 0.5, SEK: 0.1 });
assert.deepStrictEqual(got, { Alpha: 0.1, 'Bob "The Builder" Ltd': 10.1, 'Smith, Jones & Co': 0.15, Delta: 3.33 });
assert.deepStrictEqual(Object.keys(got), ['Alpha', 'Bob "The Builder" Ltd', 'Delta', 'Smith, Jones & Co']);
console.log('pass');
