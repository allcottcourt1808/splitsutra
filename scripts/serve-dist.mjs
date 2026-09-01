/**
 * Serve `apps/web/dist` the way Firebase Hosting would, so a local Lighthouse run measures
 * something close to production instead of an artefact of the dev server.
 *
 * ## Why not `vite preview`
 *
 * `vite preview` serves the built files uncompressed. Lighthouse then reports "Enable text
 * compression" against a 1.4 MB response and scores the transfer as if users downloaded that —
 * when Firebase Hosting actually serves ~346 KB brotli/gzip. The whole point of the bundle work
 * is invisible under `vite preview`, and the score it produces is wrong in the pessimistic
 * direction, which is just as misleading as being wrong in the optimistic one.
 *
 * This mirrors the four things about Hosting that change what Lighthouse sees:
 *
 *   1. **Content negotiation** — brotli, then gzip, from the `Accept-Encoding` header. Chrome
 *      asks for `br`, so that is what it gets, same as production.
 *   2. **The `firebase.json` cache headers**, copied rather than invented: `/index.html` is
 *      `no-cache` and `/assets/**` is `immutable` for a year. This drives Lighthouse's "Serve
 *      static assets with an efficient cache policy" audit — and, via `no-cache`, `bf-cache`.
 *   3. **The SPA rewrite** `** -> /index.html`, so a deep link is a 200 and not a 404.
 *   4. **Real MIME types**, because a `.js` served as `text/plain` is not a module and the app
 *      simply will not boot.
 *
 * ## What it does NOT reproduce — read this before trusting a number
 *
 * - **HTTP/1.1, not HTTP/2.** Node's `http` server is 1.1; Hosting is h2. With one entry chunk
 *   and one lazy chunk the difference is small, but it is not zero.
 * - **No TLS, no CDN, no real latency.** Localhost has none of the RTT that dominates a real
 *   first load. Use Lighthouse's own throttling (the default "Simulated throttling") and treat
 *   the result as a comparison against the previous run, not as a field measurement.
 *
 * Usage:
 *   pnpm --filter @splitsutra/web build
 *   node scripts/serve-dist.mjs          # then point Lighthouse at http://localhost:4173
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

const PORT = Number(process.env.PORT ?? 4173);
const DIST = resolve(import.meta.dirname, '../apps/web/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Only text compresses usefully; a PNG is already deflated and re-encoding it wastes CPU. */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.map',
  '.txt',
]);

/**
 * The `firebase.json` `headers` block, transcribed.
 *
 * 🔴 Keep this in step with `firebase.json` by hand — there is no shared source, so a cache
 *    rule changed there and not here makes this server quietly optimistic about a Lighthouse
 *    audit that production would fail.
 *
 * ✅ `sw.js` now has its own `no-cache` rule. It previously had none, so Hosting served it with
 *    the default `max-age=3600` below — an hour during which a shipped update could not reach
 *    anyone, because the browser would not re-fetch the worker that announces it. That is the
 *    one file where a stale copy disables the mechanism for un-staling everything else.
 */
const HOSTING_DEFAULT_MAX_AGE = 3600;

function cacheControlFor(pathname) {
  if (pathname === '/index.html' || pathname === '/') {
    // 🔴 `no-cache`, NOT `no-store` — and `firebase.json`, which cannot hold a comment, is the
    // reason this note lives here. Both keep the shell from ever being served stale, but
    // `no-store` additionally bars the back/forward cache: Lighthouse fails `bf-cache` with
    // "Pages whose main resource has cache-control:no-store cannot enter back/forward cache",
    // so an in-app Back re-downloaded and re-booted the whole bundle. Everything under
    // `/assets/**` is content-hashed and immutable, so the only thing that has to stay fresh
    // is the script tag in this file — which `no-cache` already guarantees by revalidating.
    return 'no-cache';
  }
  // The worker that announces updates must not itself be a stale cached copy.
  if (pathname === '/sw.js') return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return `public, max-age=${String(HOSTING_DEFAULT_MAX_AGE)}`;
}

/** brotli if the client asked for it, else gzip, else identity. Chrome asks for br. */
function encodeFor(acceptEncoding, body) {
  const accepted = String(acceptEncoding ?? '');
  if (accepted.includes('br')) {
    return {
      encoding: 'br',
      body: brotliCompressSync(body, {
        // Hosting serves pre-compressed assets at a high quality level; matching it keeps the
        // reported transfer size honest rather than flattering.
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      }),
    };
  }
  if (accepted.includes('gzip')) return { encoding: 'gzip', body: gzipSync(body, { level: 9 }) };
  return { encoding: null, body };
}

/** Resolve a URL path to a file inside DIST, or null. Refuses to escape DIST. */
function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  // `normalize` collapses `..` before the prefix check, so a crafted path cannot walk out.
  const candidate = normalize(join(DIST, decoded === '/' ? '/index.html' : decoded));
  if (!candidate.startsWith(DIST)) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${String(PORT)}`);

  // The SPA rewrite. Anything unmatched is a route, not a 404 — same as
  // `rewrites: [{ source: "**", destination: "/index.html" }]`.
  const file = resolveFile(pathname) ?? resolveFile('/index.html');
  if (file === null) {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end('No build found. Run: pnpm --filter @splitsutra/web build\n');
    return;
  }

  const isRewrite = !pathname.includes('.') && !pathname.startsWith('/assets/');
  const extension = extname(file);
  const type = MIME[extension] ?? 'application/octet-stream';
  const cacheControl = cacheControlFor(isRewrite ? '/index.html' : pathname);

  if (!COMPRESSIBLE.has(extension)) {
    response.writeHead(200, {
      'content-type': type,
      'cache-control': cacheControl,
      'content-length': statSync(file).size,
    });
    createReadStream(file).pipe(response);
    return;
  }

  const raw = await readFile(file);
  const { encoding, body } = encodeFor(request.headers['accept-encoding'], raw);

  response.writeHead(200, {
    'content-type': type,
    'cache-control': cacheControl,
    'content-length': body.length,
    // `Vary` matters: without it a cache in front of this would serve a brotli body to a client
    // that never asked for one.
    vary: 'Accept-Encoding',
    ...(encoding === null ? {} : { 'content-encoding': encoding }),
  });
  response.end(body);
});

server.listen(PORT, () => {
  console.log(`\n  Serving apps/web/dist as Firebase Hosting would\n`);
  console.log(`    http://localhost:${String(PORT)}\n`);
  console.log('    brotli/gzip negotiated · firebase.json cache headers · SPA rewrite');
  console.log('    HTTP/1.1 and no network latency — use Lighthouse simulated throttling.\n');
});
