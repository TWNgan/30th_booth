/**
 * Minimal static file server for the built booth.
 *
 * Why not just `vite preview`? Because a booth machine should not need a
 * toolchain, a network, or a Node process tree. This is one small file with no
 * dependencies that serves `dist/` on localhost — which browsers treat as a
 * secure context, so the camera works without HTTPS.
 *
 * Usage:  node scripts/serve.mjs [--port 4173] [--root dist]
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 4173, root: join(HERE, 'dist'), host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--port') args.port = Number(argv[++i]);
    else if (flag === '--root') args.root = resolve(argv[++i]);
    else if (flag === '--host') args.host = argv[++i];
  }
  return args;
}

export function startServer({ port = 4173, root = join(HERE, 'dist'), host = '127.0.0.1' } = {}) {
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`No index.html in ${root} — run "npm run build" first.`);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Never serve outside the root, whatever the request says.
    const candidate = normalize(join(root, pathname));
    const inside = candidate === root || candidate.startsWith(root + sep);
    const target = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : null;

    if (!target) {
      // Single-page app: unknown paths get the shell so a refresh never 404s.
      const fallback = join(root, 'index.html');
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      createReadStream(fallback).pipe(res);
      return;
    }

    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    const headers = { 'content-type': type };
    // Hashed assets are safe to cache forever; the model and shell are not.
    headers['cache-control'] = target.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-store';

    res.writeHead(200, headers);
    createReadStream(target).pipe(res);
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolvePromise({
        server,
        port: actualPort,
        url: `http://${host}:${actualPort}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Run directly
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { port, root, host } = parseArgs(process.argv.slice(2));
  const running = await startServer({ port, root, host });
  console.log(`Hands Up! booth serving ${root}`);
  console.log(`  ${running.url}`);
  console.log('Press Ctrl+C to stop.');
}
