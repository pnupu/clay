const table = require('../data/rates.json');
const { latestOnOrBefore } = require('./dates');

const cache = {};

// Units of `currency` per 1 EUR, valid on `date` (YYYY-MM-DD).
function rateFor(currency, date) {
  if (currency === 'EUR') return 1;
  if (cache[currency] !== undefined) return cache[currency];
  const day = latestOnOrBefore(Object.keys(table), date);
  if (!day || table[day][currency] === undefined) throw new Error(`no ${currency} rate for ${date}`);
  cache[currency] = table[day][currency];
  return cache[currency];
}

module.exports = { rateFor };
