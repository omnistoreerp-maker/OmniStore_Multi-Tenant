// Production startup: validates the environment, prints diagnostics,
// then launches server.js as a child process with signal forwarding so
// the graceful-shutdown hooks (SIGINT/SIGTERM) work under supervisors
// (PM2, systemd, docker stop).
// Usage: node scripts/start-production.js
const { spawn, execFileSync } = require('child_process');
const path = require('path');

// 1. Validate environment first (exits non-zero on blocking problems).
execFileSync(process.execPath, [path.join(__dirname, 'checkEnv.js')], { stdio: 'inherit' });

// 2. Launch the server, inheriting stdio so logs flow to the supervisor.
const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  stdio: 'inherit',
  env: process.env
});

// 3. Forward termination signals so the child can shut down gracefully.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child.exitCode === null) child.kill(sig);
  });
}

child.on('exit', (code, signal) => {
  process.exit(code === null ? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1) : code);
});
