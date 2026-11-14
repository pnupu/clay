function validateOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('order must be an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(order.date)) throw new Error(`bad date ${order.date}`);
  if (!Array.isArray(order.lines) || order.lines.length === 0) throw new Error('order has no lines');
  return order;
}

module.exports = { validateOrder };
