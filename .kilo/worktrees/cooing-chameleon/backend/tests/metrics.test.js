// Metrics service unit tests.
const { MetricsService } = require('../services/metrics.service');

describe('MetricsService', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  test('incrementCounter increments by label', () => {
    metrics.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
    metrics.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
    metrics.incrementCounter('http_requests_total', { method: 'POST', status: '201' });
    const m = metrics.getMetrics();
    expect(m.counters['http_requests_total{method="GET",status="200"}']).toBe(2);
    expect(m.counters['http_requests_total{method="POST",status="201"}']).toBe(1);
  });

  test('observeHistogram records values', () => {
    metrics.observeHistogram('http_request_duration_ms', 10, { method: 'GET' });
    metrics.observeHistogram('http_request_duration_ms', 20, { method: 'GET' });
    metrics.observeHistogram('http_request_duration_ms', 30, { method: 'GET' });
    const m = metrics.getMetrics();
    const h = m.histograms['http_request_duration_ms{method="GET"}'];
    expect(h.count).toBe(3);
    expect(h.avg).toBe(20);
    expect(h.max).toBe(30);
    expect(h.p95).toBe(30);
  });

  test('histogram caps at 1000 values', () => {
    for (let i = 0; i < 1100; i++) metrics.observeHistogram('x', i, { method: 'GET' });
    const m = metrics.getMetrics();
    expect(m.histograms['x{method="GET"}'].count).toBe(1000);
  });

  test('setGauge stores value', () => {
    metrics.setGauge('custom_active_users', 42);
    expect(metrics.getMetrics().gauges['custom_active_users']).toBe(42);
  });

  test('getMetrics includes runtime gauges', () => {
    const m = metrics.getMetrics();
    expect(m.gauges['process_uptime_seconds']).toBeDefined();
    expect(m.gauges['process_memory_rss_bytes']).toBeDefined();
  });

  test('toPrometheus produces counter and gauge lines', () => {
    metrics.incrementCounter('http_requests_total', { method: 'GET' });
    metrics.setGauge('process_uptime_seconds', 5);
    const out = metrics.toPrometheus();
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('http_requests_total{method="GET"} 1');
    expect(out).toContain('# TYPE process_uptime_seconds gauge');
  });

  test('reset clears all metrics', () => {
    metrics.incrementCounter('http_requests_total', {});
    metrics.reset();
    expect(metrics.getMetrics().counters).toEqual({});
    expect(metrics.getMetrics().histograms).toEqual({});
  });
});