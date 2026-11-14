const assert = require('node:assert');
const { generateInvoice } = require('../src/index');
const { formatCents } = require('../src/format');
const { latestOnOrBefore } = require('../src/dates');

assert.strictEqual(formatCents(-5, 'EUR'), '-0.05 EUR');
assert.strictEqual(latestOnOrBefore(['2026-10-01', '2026-11-02'], '2026-11-01'), '2026-10-01');
const inv = generateInvoice({ id: '1', customerId: 'C1', date: '2026-11-03', lines: [{ sku: 'A', qty: 2, unitPriceEurCents: 1000 }] });
assert.strictEqual(inv.vatCents, 510);
assert.strictEqual(inv.totalCents, 2510);
assert.strictEqual(inv.dueDate, '2026-11-17');
console.log('ok');
