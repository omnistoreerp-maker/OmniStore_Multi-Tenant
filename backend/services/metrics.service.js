// In-process metrics collection with Prometheus-compatible text output.
// Zero external dependencies; designed for low overhead per request.
class MetricsService {
  constructor() {
    this.counters = {};
    this.histograms = {};
    this.gauges = {};
  }

  _key(name, labels) {
    if (!labels) return name;
    const parts = Object.keys(labels).sort().map(k => `${k}="${labels[k]}"`);
    return parts.length ? `${name}{${parts.join(',')}}` : name;
  }

  incrementCounter(name, labels = {}) {
    const key = this._key(name, labels);
    this.counters[key] = (this.counters[key] || 0) + 1;
  }

  observeHistogram(name, value, labels = {}) {
    const key = this._key(name, labels);
    if (!this.histograms[key]) this.histograms[key] = [];
    const arr = this.histograms[key];
    arr.push(value);
    if (arr.length > 1000) arr.shift();
  }

  setGauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this.gauges[key] = value;
  }

  _summarize(key) {
    const arr = this.histograms[key];
    if (!arr || arr.length === 0) return { count: 0, sum: 0, avg: 0, max: 0, p95: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      count: arr.length,
      sum: Math.round(sum),
      avg: Math.round(sum / arr.length),
      max: Math.round(sorted[sorted.length - 1]),
      p95: Math.round(sorted[p95Idx])
    };
  }

  getMetrics() {
    this.setGauge('process_uptime_seconds', Math.round(process.uptime()));
    this.setGauge('process_memory_rss_bytes', process.memoryUsage().rss);
    const hist = {};
    for (const key of Object.keys(this.histograms)) {
      hist[key] = this._summarize(key);
    }
    return {
      counters: { ...this.counters },
      histograms: hist,
      gauges: { ...this.gauges }
    };
  }

  toPrometheus() {
    // Split metric name from label set for the TYPE line: name{labels} -> name.
    const nameOf = (key) => key.indexOf('{') === -1 ? key : key.slice(0, key.indexOf('{'));
    const lines = [];
    const metrics = this.getMetrics();
    for (const [key, val] of Object.entries(metrics.counters)) {
      lines.push(`# TYPE ${nameOf(key)} counter`);
      lines.push(`${key} ${val}`);
    }
    for (const [key, val] of Object.entries(metrics.gauges)) {
      lines.push(`# TYPE ${nameOf(key)} gauge`);
      lines.push(`${key} ${val}`);
    }
    for (const [key, val] of Object.entries(metrics.histograms)) {
      if (val.count === 0) continue;
      lines.push(`# TYPE ${nameOf(key)} summary`);
      lines.push(`${key}_count ${val.count}`);
      lines.push(`${key}_sum ${val.sum}`);
      lines.push(`${key}{quantile="0.95"} ${val.p95}`);
    }
    return lines.join('\n');
  }

  reset() {
    this.counters = {};
    this.histograms = {};
    this.gauges = {};
  }
}

module.exports = new MetricsService();
module.exports.MetricsService = MetricsService;