const assert = require('node:assert');
const { Queue, runAll } = require('../queue');

(async () => {
  const q = new Queue({ concurrency: 2 });
  const r = await Promise.all([q.add(() => 1), q.add(async () => 2), q.add(() => 3)]);
  assert.deepStrictEqual(r, [1, 2, 3]);
  await q.drain();
  assert.deepStrictEqual(await runAll([() => 'a', () => 'b'], { concurrency: 1 }), ['a', 'b']);
  let n = 0;
  const flaky = () => (++n < 2 ? Promise.reject(new Error('flaky')) : 'ok');
  assert.strictEqual(await new Queue({ concurrency: 1, retries: 2 }).add(flaky), 'ok');
  console.log('ok');
})();
