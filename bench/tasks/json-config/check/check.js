// Runs the pristine app.js (kept here, not in the agent's directory) against the agent's config.json.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const work = process.argv[2];
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
if (fs.readFileSync(path.join(work, 'app.js'), 'utf8') !== app) { console.log('fail: app.js was changed'); process.exit(1); }
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'));
fs.writeFileSync(path.join(d, 'app.js'), app);
fs.copyFileSync(path.join(work, 'config.json'), path.join(d, 'config.json'));
const r = cp.spawnSync('node', ['app.js'], { cwd: d, encoding: 'utf8' });
fs.rmSync(d, { recursive: true, force: true });
const want = 'ok host=0.0.0.0 port=8080 features=search,export maxUploadMb=25';
if (r.status !== 0 || r.stdout.trim() !== want) { console.log('fail:', r.stdout, r.stderr); process.exit(1); }
console.log('pass');
