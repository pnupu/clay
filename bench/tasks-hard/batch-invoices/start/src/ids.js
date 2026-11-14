// Invoice number: INV-<date without dashes>-<order id>.
function invoiceNumber(order) {
  return `INV-${order.date.replace(/-/g, '')}-${order.id}`;
}

module.exports = { invoiceNumber };
