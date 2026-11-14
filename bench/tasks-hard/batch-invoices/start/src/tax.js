const { percentOf } = require('./money');

function vatFor(netCents, settings) {
  if (settings.reverseCharge) return 0;
  return percentOf(netCents, settings.vatRate);
}

module.exports = { vatFor };
