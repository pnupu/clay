/**
 * Queue({ concurrency, retries = 0, retryDelayMs = 0 })
 *
 * - add(fn): fn is a function returning a value or a promise. Returns a promise for fn's result.
 *   At most `concurrency` fns run at the same time. Jobs start in the order they were added.
 *   If fn throws or rejects, it is retried up to `retries` more times (after `retryDelayMs`);
 *   a retry waits for a free slot like any other job but goes before jobs that have not started.
 *   If the last attempt fails, the promise rejects with that attempt's error.
 * - drain(): a promise that resolves when no job is running or waiting (including retries).
 *   Resolves at once if the queue is idle.
 * - stats: { running, waiting, maxRunning } where maxRunning is the highest `running` ever seen.
 *
 * runAll(fns, opts): runs all fns on a new Queue, returns a promise for an array of results in the
 * same order as fns; rejects with the first error (in fns order) if any job fails for good, but only
 * after all jobs have settled.
 */
class Queue {
  constructor({ concurrency, retries = 0, retryDelayMs = 0 }) {
    if (!(concurrency >= 1)) throw new Error('concurrency must be >= 1');
    this.concurrency = concurrency;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.waiting = [];
    this.running = 0;
    this.maxRunning = 0;
    this.idleWaiters = [];
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length, maxRunning: this.maxRunning };
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ fn, attempt: 0, resolve, reject });
      this._next();
    });
  }

  drain() {
    if (this.waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  _next() {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift();
      this._run(job);
    }
    if (this.waiting.length === 0) {
      const ws = this.idleWaiters;
      this.idleWaiters = [];
      ws.forEach((w) => w());
    }
  }

  _run(job) {
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    Promise.resolve(job.fn()).then(
      (value) => {
        this.running--;
        job.resolve(value);
        this._next();
      },
      (err) => {
        this.running--;
        if (job.attempt < this.retries) {
          job.attempt++;
          setTimeout(() => {
            this.waiting.push(job);
            this.running--;
            this._next();
          }, this.retryDelayMs);
        } else {
          job.reject(err);
        }
        this._next();
      },
    );
  }
}

async function runAll(fns, opts) {
  const q = new Queue(opts);
  const results = [];
  const errors = [];
  await Promise.all(
    fns.map((fn, i) =>
      q.add(fn).then(
        (v) => results.push(v),
        (e) => errors.push({ i, e }),
      ),
    ),
  );
  if (errors.length) throw errors[0].e;
  return results;
}

module.exports = { Queue, runAll };
