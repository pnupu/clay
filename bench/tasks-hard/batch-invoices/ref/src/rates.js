const table = require('../data/rates.json');
const { latestOnOrBefore } = require('./dates');

const cache = {};

// Units of `currency` per 1 EUR, valid on `date` (YYYY-MM-DD).
function rateFor(currency, date) {
  if (currency === 'EUR') return 1;
  const key = `${currency}@${date}`;
  if (cache[key] !== undefined) return cache[key];
  const day = latestOnOrBefore(Object.keys(table), date);
  if (!day || table[day][currency] === undefined) throw new Error(`no ${currency} rate for ${date}`);
  cache[key] = table[day][currency];
  return cache[key];
}

module.exports = { rateFor };
