const fs = require('node:fs');
const { generateBatch } = require('./index');
const { invoiceLine } = require('./format');

const orders = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const inv of generateBatch(orders)) console.log(invoiceLine(inv));
