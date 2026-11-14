// Calendar-day helpers. A "day" is a YYYY-MM-DD string in the account's time zone.

function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, mo, d };
}

// UTC milliseconds at which `day` starts in a time zone `offsetMinutes` east of UTC.
function dayStartUtc(day, offsetMinutes) {
  return Date.UTC(day.y, day.mo - 1, day.d) - offsetMinutes * 60000;
}

function formatLocal(ms, offsetMinutes) {
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 16).replace('T', ' ');
}

module.exports = { parseDay, dayStartUtc, formatLocal };
