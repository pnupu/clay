import fs from 'node:fs';

export function loadSales() {
  const url = new URL('../sales.json', import.meta.url);
  return JSON.parse(fs.readFileSync(url, 'utf8'));
}
