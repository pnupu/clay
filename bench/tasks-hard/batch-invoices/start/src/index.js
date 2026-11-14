const { generateInvoice } = require('./invoice');

function generateBatch(orders) {
  return orders.map((o) => generateInvoice(o));
}

module.exports = { generateInvoice, generateBatch };
