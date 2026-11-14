const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const work = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8'));
if (pkg.type !== 'module') { console.log('fail: type is not module'); process.exit(1); }
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]);
if (walk(work).some(n => n.endsWith('.cjs'))) { console.log('fail: .cjs file present'); process.exit(1); }
const want = ['north   1200.50 EUR', 'south    830.00 EUR', 'west      99.99 EUR', 'TOTAL   2130.49 EUR'].join('\n');
const r = cp.spawnSync('node', ['src/index.js'], { cwd: work, encoding: 'utf8', timeout: 30000 });
if (r.status !== 0 || r.stdout.trimEnd() !== want) { console.log('fail:', JSON.stringify(r.stdout), r.stderr); process.exit(1); }
// The report must still read sales.json at run time.
const salesPath = path.join(work, 'sales.json'), orig = fs.readFileSync(salesPath);
fs.writeFileSync(salesPath, '[{"region":"east","amount":5}]');
const r2 = cp.spawnSync('node', ['src/index.js'], { cwd: work, encoding: 'utf8', timeout: 30000 });
fs.writeFileSync(salesPath, orig);
if (r2.stdout.trimEnd() !== 'east       5.00 EUR\nTOTAL      5.00 EUR') { console.log('fail: sales.json not read', r2.stdout); process.exit(1); }
console.log('pass');
