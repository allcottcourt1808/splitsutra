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
    alias: {
      '@': here('./src'),
      /* Resolve @splitsutra/core to SOURCE so `pnpm dev` works on a clean clone with no
         build step in core, and so HMR crosses the package boundary. Mirrors the
         `paths` entry in tsconfig.json — change both together. */
      '@splitsutra/core': here('../../packages/core/src/index.ts'),
    },
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
