// Latest of the YYYY-MM-DD strings in `days` that is on or before `date`, or null.
function latestOnOrBefore(days, date) {
  let best = null;
  for (const d of days) if (d < date && (best === null || d > best)) best = d;
  return best;
}

function addDays(date, n) {
  const t = new Date(date + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

module.exports = { latestOnOrBefore, addDays };
