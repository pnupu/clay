const fs = require('node:fs'), path = require('node:path');
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}
const file = process.argv[2];
const rates = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'rates.json'), 'utf8'));
const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
const tot = {};
for (const r of rows) {
  if (r[ix.status].trim() !== 'paid') continue;
  const c = r[ix.customer];
  tot[c] = (tot[c] || 0) + parseFloat(r[ix.amount]) * rates[r[ix.currency].trim()];
}
const out = {};
for (const k of Object.keys(tot).sort()) out[k] = Math.round(tot[k] * 100) / 100;
console.log(JSON.stringify(out));
