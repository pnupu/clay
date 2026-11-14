// Return the items on a 1-based page.
function paginate(items, page, pageSize) {
  const start = page * pageSize;
  return items.slice(start, start + pageSize);
}

// Number of pages needed to show all items.
function pageCount(items, pageSize) {
  return Math.floor(items.length / pageSize);
}

module.exports = { paginate, pageCount };
