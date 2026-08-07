'use strict';

// LifecycleManager —— coordinates boot/shutdown sequences for the container.
//
// Infrastructure only; NOT wired into the runtime. It tracks lifecycle hooks
// (start/stop functions) that future container adopters may register, and it
// is intentionally empty at construction (no default hooks, no side effects).

const { LifecycleError } = require('./ContainerErrors');

const LIFECYCLE_STATES = Object.freeze({
  CREATED: 'created',
  STARTING: 'starting',
  STARTED: 'started',
  STOPPING: 'stopping',
  STOPPED: 'stopped'
});

class LifecycleManager {
  constructor() {
    this._state = LIFECYCLE_STATES.CREATED;
    this._startHooks = [];
    this._stopHooks = [];
  }

  get state() {
    return this._state;
  }

  onStart(fn) {
    if (typeof fn !== 'function') throw new Error('onStart expects a function');
    this._startHooks.push(fn);
    return this;
  }

  onStop(fn) {
    if (typeof fn !== 'function') throw new Error('onStop expects a function');
    this._stopHooks.push(fn);
    return this;
  }

  async start() {
    if (this._state === LIFECYCLE_STATES.STARTED) return this;
    this._state = LIFECYCLE_STATES.STARTING;
    try {
      for (const hook of this._startHooks) {
        await hook();
      }
      this._state = LIFECYCLE_STATES.STARTED;
      return this;
    } catch (err) {
      throw new LifecycleError(err);
    }
  }

  async stop() {
    if (this._state === LIFECYCLE_STATES.STOPPED) return this;
    this._state = LIFECYCLE_STATES.STOPPING;
    try {
      // Stopping in reverse registration order (LIFO) is conventional.
      for (let i = this._stopHooks.length - 1; i >= 0; i -= 1) {
        await this._stopHooks[i]();
      }
      this._state = LIFECYCLE_STATES.STOPPED;
      return this;
    } catch (err) {
      throw new LifecycleError(err);
    }
  }
}

module.exports = LifecycleManager;
module.exports.LIFECYCLE_STATES = LIFECYCLE_STATES;