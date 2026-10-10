const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Foreground jest runner for Education test suites.
 *
 * Usage: node run-suite.js suite1.js suite2.js ...
 *   Runs each suite synchronously (parent waits). Use with --testTimeout=300000
 *   to give slow suites headroom; the tool environment caps total command
 *   runtime at 30s, so suites that do not finish in that window are killed
 *   mid-run (marked NOT COMPLETED in the report).
 */

(async () => {
  const suites = process.argv.slice(2);
  if (!suites.length) throw new Error('Usage: node run-suite.js suite1.js suite2.js ...');

  const JEST_TIMEOUT = process.env.JEST_TIMEOUT || 300000; // per-test timeout

  for (const suite of suites) {
    const testPath = path.join(__dirname, 'tests', suite);
    const outPath = path.join(__dirname, 'results', suite + '.out');
    const errPath = path.join(__dirname, 'results', suite + '.err');
    const summaryPath = path.join(__dirname, 'results', suite + '.summary.json');

    const outFd = fs.createWriteStream(outPath, { flags: 'a' });
    const errFd = fs.createWriteStream(errPath, { flags: 'a' });
    outFd.write('\n================ ' + suite + ' ================\n', 'utf8');

    const proc = spawn('node', [require.resolve('jest/bin/jest'), '--testTimeout=' + JEST_TIMEOUT, testPath], {
      cwd: __dirname,
      env: process.env
    });

    proc.stdout.pipe(outFd);
    proc.stderr.pipe(errFd);

    await new Promise((resolve) => {
      proc.on('close', (code, signal) => {
        outFd.end();
        errFd.end();
        const status = code === 0 ? 'PASS' : 'FAIL';
        const summary = { suite, status, exitCode: code, signal, timestamp: new Date().toISOString() };
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
        console.error('[run-suite] ' + suite + ' closed code=' + code + ' signal=' + signal + ' => ' + status);
        resolve();
      });
    });
  }

  console.log('[run-suite] done');
})();