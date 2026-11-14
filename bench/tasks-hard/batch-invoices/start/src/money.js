// Integer cents helpers. Rounding is half away from zero.
function roundHalfAway(x) {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function convert(cents, rate) {
  return roundHalfAway(cents * rate);
}

function percentOf(cents, rate) {
  return roundHalfAway(cents * rate);
}

module.exports = { roundHalfAway, convert, percentOf };
