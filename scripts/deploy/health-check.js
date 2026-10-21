#!/usr/bin/env node
// Standalone deployment health gate for OmniStore.
//
// The documented service contract is:
//   GET /api/v1/health -> 200 with data.status === "ok"
//   GET /api/v1/ready  -> 200 with data.status === "ready" and data.persistence === "writable"
//
// The legacy /health path is intentionally NOT used: it returns 404 on this
// service, which caused the on-host deploy script to report DEPLOY_RESULT=FAILED
// even when the service was healthy.
//
// This file has no dependencies and is meant to be installed next to the deploy
// script (outside the application checkout), so it stays valid for any candidate
// SHA. It never prints response bodies or credentials.
//
// Usage:
//   node health-check.js [--base URL] [--health-path PATH] [--ready-path PATH]
//                        [--timeout-ms N]
//
// Exit codes: 0 = healthy, 1 = unhealthy, 2 = invalid arguments.
'use strict';

const http = require('http');
const https = require('https');

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:3001',
  healthPath: '/api/v1/health',
  readyPath: '/api/v1/ready',
  timeoutMs: 10000,
};
const MAX_BODY_BYTES = 64 * 1024;

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.HEALTH_BASE_URL || DEFAULTS.baseUrl,
    healthPath: process.env.HEALTH_PATH || DEFAULTS.healthPath,
    readyPath: process.env.READY_PATH || DEFAULTS.readyPath,
    timeoutMs: parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || DEFAULTS.timeoutMs,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case '--base':
        opts.baseUrl = value();
        break;
      case '--health-path':
        opts.healthPath = value();
        break;
      case '--ready-path':
        opts.readyPath = value();
        break;
      case '--timeout-ms':
        opts.timeoutMs = parseInt(value(), 10);
        if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
          throw new Error('--timeout-ms must be a positive integer');
        }
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  let parsed;
  try {
    parsed = new URL(opts.baseUrl);
  } catch {
    throw new Error('--base must be a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--base must use http or https');
  }
  if (!opts.healthPath.startsWith('/') || !opts.readyPath.startsWith('/')) {
    throw new Error('health/ready paths must start with /');
  }
  return opts;
}

function fetchJson(baseUrl, path, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let url;
    try {
      url = new URL(path, baseUrl);
    } catch (err) {
      finish({ error: `invalid URL: ${err.message}` });
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish({ statusCode: res.statusCode });
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
          req.destroy(new Error('response body too large'));
        }
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        finish({ statusCode: res.statusCode, json });
      });
      res.on('error', (err) => finish({ error: err.message }));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err) => finish({ error: err.message }));
  });
}

function checkHealth(result) {
  if (result.error) return `request failed (${result.error})`;
  if (result.statusCode !== 200) return `HTTP ${result.statusCode}`;
  const data = result.json && result.json.data;
  if (!data || data.status !== 'ok') return 'payload data.status is not "ok"';
  return null;
}

function checkReady(result) {
  if (result.error) return `request failed (${result.error})`;
  if (result.statusCode !== 200) return `HTTP ${result.statusCode}`;
  const data = result.json && result.json.data;
  if (!data || data.status !== 'ready') return 'payload data.status is not "ready"';
  if (data.persistence !== 'writable') return 'payload data.persistence is not "writable"';
  return null;
}

async function run(opts) {
  const checks = [
    { name: 'health', path: opts.healthPath, validate: checkHealth },
    { name: 'ready', path: opts.readyPath, validate: checkReady },
  ];

  let healthy = true;
  for (const check of checks) {
    const result = await fetchJson(opts.baseUrl, check.path, opts.timeoutMs);
    const reason = check.validate(result);
    if (reason) {
      healthy = false;
      console.log(`${check.name.toUpperCase()}_CHECK=FAIL path=${check.path} reason=${reason}`);
    } else {
      console.log(`${check.name.toUpperCase()}_CHECK=PASS path=${check.path} http=${result.statusCode}`);
    }
  }

  console.log(`HEALTH_CHECK=${healthy ? 'PASS' : 'FAIL'}`);
  return healthy;
}

function usage() {
  return [
    'Usage: node health-check.js [options]',
    '',
    `  --base URL           base URL (default ${DEFAULTS.baseUrl})`,
    `  --health-path PATH   health path (default ${DEFAULTS.healthPath})`,
    `  --ready-path PATH    readiness path (default ${DEFAULTS.readyPath})`,
    `  --timeout-ms N       per-request timeout (default ${DEFAULTS.timeoutMs})`,
  ].join('\n');
}

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`HEALTH_CHECK=FAIL reason=${err.message}`);
    process.exit(2);
  }

  if (opts.help) {
    console.log(usage());
    process.exit(0);
  }

  run(opts)
    .then((healthy) => {
      process.exitCode = healthy ? 0 : 1;
    })
    .catch((err) => {
      console.error(`HEALTH_CHECK=FAIL reason=${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULTS,
  parseArgs,
  fetchJson,
  checkHealth,
  checkReady,
  run,
};
