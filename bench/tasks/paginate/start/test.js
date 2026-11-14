const assert = require('node:assert');
const { paginate, pageCount } = require('./paginate');
const items = [1, 2, 3, 4, 5, 6, 7];
assert.deepStrictEqual(paginate(items, 1, 3), [1, 2, 3]);
assert.deepStrictEqual(paginate(items, 3, 3), [7]);
assert.strictEqual(pageCount(items, 3), 3);
console.log('ok');
