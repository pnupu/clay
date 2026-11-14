// Hidden stress check for queue.js. Deterministic pseudo-random delays and failures.
const path = require('node:path');
const { Queue, runAll } = require(path.join(process.argv[2], 'queue.js'));
const fail = (kind, why) => { console.log(`FAIL ${kind}: ${why}`); process.exit(1); };
process.on('unhandledRejection', (e) => fail('wrong-output', 'unhandled rejection: ' + (e && e.message)));
process.on('uncaughtException', (e) => fail('wrong-output', 'uncaught exception: ' + (e && e.message)));
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => {
  let t;
  const guard = new Promise((_, rej) => { t = setTimeout(() => fail('wrong-output', `${what} did not settle within ${ms} ms`), ms); });
  return Promise.race([p, guard]).finally(() => clearTimeout(t));
};

async function stress(concurrency, retries, n) {
  const q = new Queue({ concurrency, retries, retryDelayMs: 1 });
  let active = 0, maxActive = 0, settled = 0;
  const firstStarts = [];
  const plan = Array.from({ length: n }, () => ({ fails: Math.floor(rnd() * (retries + 2)), delay: Math.floor(rnd() * 4), sync: rnd() < 0.2, syncThrow: rnd() < 0.1 }));
  const promises = plan.map((p, i) => {
    let attempt = 0;
    const fn = () => {
      if (attempt === 0) firstStarts.push(i);
      const a = attempt++;
      active++; maxActive = Math.max(maxActive, active);
      if (p.syncThrow && a < p.fails) { active--; throw new Error(`sync ${i}/${a}`); }
      if (p.sync && a >= p.fails) { active--; return `r${i}`; }
      return sleep(p.delay).then(() => { active--; if (a < p.fails) throw new Error(`e${i}/${a}`); return `r${i}`; });
    };
    const pr = q.add(fn).then((v) => { settled++; return { ok: v }; }, (e) => { settled++; return { err: e.message }; });
    return pr;
  });
  // drain() called while work is in flight must resolve only once everything has settled.
  await sleep(2);
  await withTimeout(q.drain(), 20000, 'drain()');
  if (settled !== n) fail('wrong-output', `drain() resolved with ${n - settled} of ${n} jobs not settled (concurrency ${concurrency}, retries ${retries})`);
  if (q.stats.running !== 0 || q.stats.waiting !== 0) fail('wrong-output', `stats after drain: ${JSON.stringify(q.stats)}`);
  const res = await Promise.all(promises);
  if (maxActive > concurrency) fail('wrong-output', `${maxActive} jobs ran at once with concurrency ${concurrency}`);
  if (q.stats.maxRunning > concurrency) fail('wrong-output', `stats.maxRunning ${q.stats.maxRunning} > concurrency ${concurrency}`);
  for (let i = 0; i < n; i++) {
    const p = plan[i];
    const want = p.fails > retries ? { err: `${p.syncThrow ? 'sync' : 'e'}${i}/${retries}` } : { ok: `r${i}` };
    if (p.fails > retries && p.syncThrow) want.err = `sync ${i}/${retries}`;
    if (JSON.stringify(res[i]) !== JSON.stringify(want)) fail('wrong-output', `job ${i}: got ${JSON.stringify(res[i])}, want ${JSON.stringify(want)} (concurrency ${concurrency}, retries ${retries})`);
  }
  for (let i = 1; i < firstStarts.length; i++) if (firstStarts[i] < firstStarts[i - 1]) fail('wrong-output', 'jobs did not start in the order they were added');
  await withTimeout(q.drain(), 1000, 'drain() on an idle queue');
}

(async () => {
  // Idle drain resolves at once.
  await withTimeout(new Queue({ concurrency: 2 }).drain(), 500, 'drain() on a new queue');
  // A retry goes before jobs that have not started.
  {
    const q = new Queue({ concurrency: 1, retries: 1, retryDelayMs: 10 });
    const order = [];
    let aTries = 0;
    const ps = [
      q.add(() => { order.push('A'); return ++aTries === 1 ? Promise.reject(new Error('x')) : 'a'; }),
      q.add(() => { order.push('B'); return sleep(30).then(() => 'b'); }),
      q.add(() => { order.push('C'); return 'c'; }),
      q.add(() => { order.push('D'); return 'd'; }),
    ];
    await withTimeout(Promise.all(ps), 5000, 'retry-order jobs');
    if (order.join('') !== 'ABACD') fail('wrong-output', `retry ran in the wrong place: start order ${order.join('')}, want ABACD`);
  }
  for (const [c, r, n] of [[1, 0, 40], [3, 2, 400], [5, 1, 800], [8, 3, 1500], [2, 3, 300]]) await stress(c, r, n);
  // runAll: results in fns order; rejection after all settled, with the first error in fns order.
  {
    const fns = Array.from({ length: 200 }, (_, i) => () => sleep(Math.floor(rnd() * 5)).then(() => i * 2));
    const out = await withTimeout(runAll(fns, { concurrency: 7 }), 20000, 'runAll');
    if (JSON.stringify(out) !== JSON.stringify(fns.map((_, i) => i * 2))) fail('wrong-output', 'runAll results are not in fns order');
    let done = 0;
    const fns2 = Array.from({ length: 50 }, (_, i) => () => sleep(i === 3 ? 20 : i === 30 ? 1 : 5).then(() => { done++; if (i === 3 || i === 30) throw new Error(`bad${i}`); return i; }));
    try {
      await withTimeout(runAll(fns2, { concurrency: 10 }), 20000, 'runAll with failures');
      fail('wrong-output', 'runAll did not reject');
    } catch (e) {
      if (e.message !== 'bad3') fail('wrong-output', `runAll rejected with ${e.message}, want bad3 (first in fns order)`);
      if (done !== 50) fail('wrong-output', `runAll rejected before all jobs settled (${done}/50)`);
    }
  }
  console.log('pass');
  process.exit(0);
})();
