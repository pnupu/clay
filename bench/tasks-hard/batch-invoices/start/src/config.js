// Defaults for every customer. A customer's own `settings` override these.
const DEFAULTS = {
  currency: 'EUR',
  vatRate: 0.255,
  reverseCharge: false,
  paymentTermsDays: 14,
  locale: 'fi-FI',
};

module.exports = { DEFAULTS };
