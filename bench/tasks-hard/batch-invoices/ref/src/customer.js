const { DEFAULTS } = require('./config');
const customers = require('../data/customers.json');

function findCustomer(id) {
  const c = customers.find((x) => x.id === id);
  if (!c) throw new Error(`unknown customer ${id}`);
  return c;
}

// Effective settings for one customer: defaults, then the customer's overrides.
function resolveCustomer(id) {
  const customer = findCustomer(id);
  const settings = { ...DEFAULTS, ...(customer.settings || {}) };
  return { id: customer.id, name: customer.name, ...settings };
}

module.exports = { resolveCustomer, findCustomer };
