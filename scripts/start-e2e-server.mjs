import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const e2ePort = process.env.E2E_PORT ?? '3100';
const nextMode = process.env.E2E_NEXT_MODE ?? 'production';
if (!['production', 'dev'].includes(nextMode)) {
  throw new Error(`E2E_NEXT_MODE must be "production" or "dev", received "${nextMode}".`);
}
const e2eEnvironment = {
  ...process.env,
  APP_URL: process.env.APP_URL ?? `http://127.0.0.1:${e2ePort}`,
  NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-e2e',
};
const spawnOptions = {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: e2eEnvironment,
};

const run = (args) => new Promise((resolve) => {
  const child = spawn(npmCommand, args, spawnOptions);
  child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
});

if (nextMode === 'production') {
  const build = await run(['run', 'build']);
  if (build.signal || build.code !== 0) process.exit(build.code);
}

const server = spawn(
  npmCommand,
  ['run', nextMode === 'dev' ? 'dev' : 'start', '--', '--hostname', '127.0.0.1', '--port', e2ePort],
  spawnOptions,
);
server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
