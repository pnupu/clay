import { sum } from './util.js';

export default function formatReport(rows, { currency }) {
  const lines = rows.map(r => `${r.region.padEnd(6)} ${r.amount.toFixed(2).padStart(8)} ${currency}`);
  lines.push(`${'TOTAL'.padEnd(6)} ${sum(rows.map(r => r.amount)).toFixed(2).padStart(8)} ${currency}`);
  return lines.join('\n');
}
