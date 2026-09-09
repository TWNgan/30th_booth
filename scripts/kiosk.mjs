/**
 * Booth launcher: serves the built game and opens it in full-screen kiosk
 * Chrome, with the camera permission pre-granted so no student ever sees a
 * browser dialog.
 *
 * Usage:  npm run kiosk            (after npm run build)
 *         npm run kiosk -- --port 5000
 *
 * Flags worth knowing:
 *   --windowed   run as a normal window instead of full-screen kiosk
 *   --browser <path>  use a specific Chrome/Chromium binary
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startServer } from './serve.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

function findBrowser(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const list = CANDIDATES[process.platform] ?? [];
  return list.find((path) => existsSync(path)) ?? null;
}

const argv = process.argv.slice(2);
const windowed = argv.includes('--windowed');
const portArgIndex = argv.indexOf('--port');
const browserArgIndex = argv.indexOf('--browser');
const port = portArgIndex >= 0 ? Number(argv[portArgIndex + 1]) : 4173;
const browserPath = findBrowser(browserArgIndex >= 0 ? argv[browserArgIndex + 1] : undefined);

const dist = join(HERE, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found. Run "npm run build" first.');
  process.exit(1);
}

if (!browserPath) {
  console.error('Could not find Chrome, Chromium, Edge or Brave.');
  console.error('Set CHROME_PATH, or pass --browser "/path/to/chrome".');
  process.exit(1);
}

const { url, close } = await startServer({ port, root: dist });
console.log(`Serving the booth at ${url}`);
console.log(`Launching ${browserPath}`);

const flags = [
  `--app=${url}`,
  // Camera permission without a prompt, and audio without a user gesture.
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-features=Translate,MediaRouter',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--overscroll-history-navigation=0',
  '--disable-pinch',
  '--user-data-dir=' + join(HERE, '.kiosk-profile'),
];

if (!windowed) {
  flags.push('--kiosk', '--start-fullscreen', '--disable-restore-session-state');
}

const child = spawn(browserPath, flags, { stdio: 'inherit' });

const shutdown = async () => {
  child.kill();
  await close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
child.on('exit', shutdown);
