const { convert } = require('./money');

// Order lines -> invoice lines in the invoice currency.
function buildLines(orderLines, rate) {
  return orderLines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error(`bad qty for ${l.sku}`);
    const unit = convert(l.unitPriceEurCents, rate);
    return { sku: l.sku, qty: l.qty, unitCents: unit, totalCents: unit * l.qty };
  });
}

module.exports = { buildLines };
