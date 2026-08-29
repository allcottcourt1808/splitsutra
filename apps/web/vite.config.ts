import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/** Repo root — one level above `apps/`. */
const repoRoot = here('../../');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    /* NFR-2: main JS bundle < 350 KB gzipped. The treemap is written on every build
       so a regression is visible before it reaches CI. */
    ...(command === 'build'
      ? [
          visualizer({
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true,
            template: 'treemap',
          }),
        ]
      : []),
  ],

  /* Only `VITE_*` reaches the client bundle. Everything in .env.example is a public
     Firebase identifier — see the note at the top of that file. */
  envPrefix: 'VITE_',

  resolve: {
    /* Array form, not the object shorthand, because ORDER MATTERS here and the array is the
       only form that makes it explicit. See the subpath rule below. */
    alias: [
      /* 🔴 The subpath rule MUST come first.

         A string `find` in Rollup's alias plugin matches the exact specifier AND anything
         under it — `find` or `find + '/'`. So with only the bare rule below,
         `@splitsutra/core/hooks` matched it and was rewritten to
         `packages/core/src/index.ts/hooks`, which is not a path. The dev server failed to
         boot with "Failed to resolve import" the moment the first subpath import landed.

         apps/web/tsconfig.json has carried BOTH halves (`@splitsutra/core` and
         `@splitsutra/core/*`) since it was written; this file only ever mirrored the first,
         despite the comment below saying the two change together. Nothing caught it because
         no code in apps/web imported a core subpath until the Friends screens did — a green
         `pnpm verify` cannot see this, since typecheck resolves through tsconfig and never
         asks Vite anything. */
      {
        find: /^@splitsutra\/core\/(.*)$/,
        replacement: `${here('../../packages/core/src')}/$1/index.ts`,
      },
      /* Resolve @splitsutra/core to SOURCE so `pnpm dev` works on a clean clone with
         nothing built yet, and so HMR crosses the package boundary. Core does have a real
         build now — firebase/functions consumes that, because Node resolves the .js
         specifiers core's imports carry and nothing was emitting them — but the web app has
         no reason to wait for it. Mirrors the `paths` entry in
         tsconfig.json — change both together, BOTH entries. */
      { find: '@splitsutra/core', replacement: here('../../packages/core/src/index.ts') },
      /* Last, and harmless where it sits: `'@'` matches `@/foo` but not `@splitsutra/...`,
         because the plugin requires the exact string or the string followed by a slash. */
      { find: '@', replacement: here('./src') },
    ],
  },

  server: {
    port: 5173,
    /* Serving core from source means reading outside the app root. */
    fs: { allow: [repoRoot] },
  },

  optimizeDeps: {
    /* FirebaseUI was dropped (docs/19-qa-log.md Q17/R7), and with it the firebase/compat
       shim it required. Auth now uses the modular firebase/auth SDK, which Vite discovers
       by crawling like any other ESM dependency — so nothing needs pre-bundling here. */
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    /* Deliberately below the NFR-2 ceiling: the warning should fire while there is
       still headroom, not once the budget is already blown. */
    chunkSizeWarningLimit: 300,
  },
}));
