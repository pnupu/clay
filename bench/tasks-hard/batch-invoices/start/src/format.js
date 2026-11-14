function formatCents(cents, currency) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')} ${currency}`;
}

function invoiceLine(inv) {
  return [inv.number, inv.customerId, `net=${formatCents(inv.netCents, inv.currency)}`,
    `vat=${formatCents(inv.vatCents, inv.currency)}`, `total=${formatCents(inv.totalCents, inv.currency)}`].join(' ');
}

module.exports = { formatCents, invoiceLine };
