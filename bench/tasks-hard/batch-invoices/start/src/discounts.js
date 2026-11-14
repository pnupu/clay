const { percentOf } = require('./money');

// A customer discount is a percentage of the line subtotal.
function discountFor(subtotalCents, discountRate) {
  if (!discountRate) return 0;
  return percentOf(subtotalCents, discountRate);
}

module.exports = { discountFor };
