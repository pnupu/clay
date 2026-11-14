const { resolveCustomer } = require('./customer');
const { rateFor } = require('./rates');
const { buildLines } = require('./lines');
const { discountFor } = require('./discounts');
const { vatFor } = require('./tax');
const { validateOrder } = require('./validate');
const { invoiceNumber } = require('./ids');
const { addDays } = require('./dates');

function generateInvoice(order) {
  validateOrder(order);
  const settings = resolveCustomer(order.customerId);
  const rate = rateFor(settings.currency, order.date);
  const lines = buildLines(order.lines, rate);
  const subtotalCents = lines.reduce((a, l) => a + l.totalCents, 0);
  const discountCents = discountFor(subtotalCents, settings.discountRate);
  const netCents = subtotalCents - discountCents;
  const vatCents = vatFor(netCents, settings);
  return {
    number: invoiceNumber(order), customerId: settings.id, date: order.date,
    dueDate: addDays(order.date, settings.paymentTermsDays), currency: settings.currency, rate,
    lines, subtotalCents, discountCents, netCents, vatCents, totalCents: netCents + vatCents,
  };
}

module.exports = { generateInvoice };
