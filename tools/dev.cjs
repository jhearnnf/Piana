'use strict';

/**
 * The desktop app against the Vite dev server, so edits hot-reload in the
 * window instead of needing a rebuild.
 *
 *   npm run app:dev
 *
 * Starts Vite, waits for it to announce a URL, then launches Electron pointed
 * at it. Written as a script rather than pulled in as a `concurrently`-style
 * dependency because the ordering matters — Electron opening before the server
 * is listening just shows an error page — and that is most of what such a
 * dependency would be doing.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const ELECTRON = require('electron'); // the module exports the binary's path

// Vite prints "Local:   http://localhost:5173/" once it is actually listening.
// Colour codes have to come off first: Vite bolds the port number, so they
// land *inside* the URL as well as between "Local" and its colon.
const ANSI = /\x1b\[[0-9;]*m/g;
const URL_LINE = /Local:\s+(https?:\/\/\S+)/;

const children = new Set();
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  process.exit(code);
}

function track(child) {
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

const vite = track(spawn(process.execPath, [VITE], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, FORCE_COLOR: '1' },
}));

let launched = false;

vite.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  const match = text.replace(ANSI, '').match(URL_LINE);
  if (!match || launched) return;
  launched = true;

  const url = match[1].replace(/\/$/, '');
  console.log(`\n[piana] launching the desktop shell against ${url}\n`);

  const electron = track(spawn(ELECTRON, [ROOT], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, PIANA_DEV_URL: url },
  }));

  // Closing the window ends the session; leaving a dev server running in the
  // background is how you end up with three of them.
  electron.on('exit', (code) => stopAll(code ?? 0));
});

vite.on('exit', (code) => {
  if (!launched) console.error('[piana] the dev server exited before it was ready');
  stopAll(code ?? 1);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0));
