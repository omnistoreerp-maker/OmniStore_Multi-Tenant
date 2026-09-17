// Scheduler unit tests.
const { SchedulerService } = require('../services/scheduler.service');

describe('SchedulerService', () => {
  let sched;

  beforeEach(() => {
    sched = new SchedulerService();
  });

  afterEach(() => {
    sched.stop();
  });

  test('register requires a handler function', () => {
    expect(() => sched.register('t', '5s', 'not-fn')).toThrow(/handler function/);
  });

  test('rejects invalid specs', () => {
    expect(() => sched.register('t', 'garbage', () => {})).toThrow(/Invalid schedule spec/);
  });

  test('accepts numeric ms spec', () => {
    expect(() => sched.register('t', 500, () => {})).not.toThrow();
  });

  test('accepts human-readable specs', () => {
    expect(() => sched.register('t', '5m', () => {})).not.toThrow();
    expect(() => sched.register('u', '@hourly', () => {})).not.toThrow();
    expect(() => sched.register('v', '1d', () => {})).not.toThrow();
  });

  test('runs a task on interval', async () => {
    let count = 0;
    sched.register('tick', 50, async () => { count++; });
    sched.start();
    await new Promise(r => setTimeout(r, 150));
    sched.stop();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('tracks lastRunAt and runs count', async () => {
    sched.register('task', 50, async () => {});
    sched.start();
    await new Promise(r => setTimeout(r, 120));
    sched.stop();
    const tasks = sched.listTasks();
    const t = tasks.find(x => x.name === 'task');
    expect(t.runs).toBeGreaterThanOrEqual(1);
    expect(t.lastRunAt).toBeTruthy();
  });

  test('stop prevents further runs', async () => {
    let count = 0;
    sched.register('tick', 30, async () => { count++; });
    sched.start();
    await new Promise(r => setTimeout(r, 100));
    sched.stop();
    const after = count;
    await new Promise(r => setTimeout(r, 100));
    expect(count).toBe(after);
  });

  test('failed task is recorded as failed and continues scheduling', async () => {
    let count = 0;
    sched.register('flaky', 30, async () => { count++; if (count === 1) throw new Error('nope'); });
    sched.start();
    await new Promise(r => setTimeout(r, 120));
    sched.stop();
    const tasks = sched.listTasks();
    const t = tasks.find(x => x.name === 'flaky');
    expect(t.lastStatus).toBe('completed'); // second run succeeded
    expect(t.runs).toBeGreaterThanOrEqual(2);
  });

  test('unregister removes a task', () => {
    sched.register('t', 1000, () => {});
    expect(sched.unregister('t')).toBe(true);
    expect(sched.unregister('t')).toBe(false);
    expect(sched.listTasks()).toHaveLength(0);
  });
});