// In-process async mutex used to serialize stock-mutating checkouts so two
// concurrent checkouts can never both read the same stock level and oversell.
// The fileStore writes are synchronous, so holding this lock across the
// read-modify-write of the products document makes the decrement atomic with
// respect to other in-process requests.
class AsyncLock {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  acquire() {
    return new Promise((resolve) => {
      const task = () => resolve(this._release.bind(this));
      if (this._locked) this._queue.push(task);
      else {
        this._locked = true;
        task();
      }
    });
  }

  _release() {
    if (this._queue.length) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }
}

const stockLock = new AsyncLock();

module.exports = { AsyncLock, stockLock };
