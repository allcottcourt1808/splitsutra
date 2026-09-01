import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA } from 'vite-plugin-pwa';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/** Repo root — one level above `apps/`. */
const repoRoot = here('../../');

export default defineConfig(({ command }) => ({
  plugins: [
    react(),

    /**
     * Installable to the home screen — checklists/phase-09 §5.
     *
     * 🔴 THE SERVICE WORKER CACHES THE APP SHELL AND NOTHING ELSE. `globPatterns` names build
     *    output only, and there is deliberately NO `runtimeCaching` entry for Firestore or any
     *    googleapis origin.
     *
     *    Firestore has its own offline persistence and its own consistency rules. A second
     *    cache in front of it does not make the app more offline-capable, it makes two layers
     *    disagree — and the thing they would disagree about is a balance. A stale balance shown
     *    with full confidence is the worst bug this product can have (Article V: the ledger is
     *    the only truth). Do not add runtime caching here for anything that answers with data.
     *
     * `registerType: 'prompt'` rather than `autoUpdate`: a silent swap can replace the running
     * bundle mid-edit, and this app's central screen is a form. The user is told instead.
     */
    VitePWA({
      registerType: 'prompt',
      // No `includeAssets`: `globPatterns` below already matches every png and svg in the
      // output, and naming them twice puts each icon in the precache manifest twice.
      manifest: {
        name: 'SplitSutra',
        // Home-screen labels are truncated around 12 characters on both platforms; anything
        // longer is chosen for you, and rarely well.
        short_name: 'SplitSutra',
        description: 'Split expenses with friends and settle up without the arithmetic.',
        // Standalone is what makes it open without browser chrome — the whole point of
        // installing it. `start_url` is the tab bar's home (paths.HOME_PATH).
        display: 'standalone',
        start_url: '/groups',
        scope: '/',
        orientation: 'portrait',
        // From tokens.ts (Article IX). `theme_color` paints the Android status bar, so it is
        // `primary`; `background_color` is the splash behind the app before first paint, and
        // is `bg` so the launch does not flash a colour the app never uses.
        theme_color: '#1CC29F',
        background_color: '#FFFFFF',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          // 🔴 `maskable` is a separate entry, never `purpose: 'any maskable'` on a shared
          //    file: Android crops a maskable icon to 80% diameter, so one image cannot be
          //    correct for both. The maskable art is drawn smaller. See scripts/make-icons.mjs.
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The treemap the visualizer writes is a build artefact for us, not for a user's phone.
        globIgnores: ['**/stats.html'],
        // Deep links must work offline: any navigation the SW cannot match falls back to the
        // shell, and the router takes it from there.
        navigateFallback: '/index.html',
      },
      // The dev server does not register a worker. Installability is verified against a real
      // `pnpm build && pnpm preview`, which is what the checklist asks for.
      devOptions: { enabled: false },
    }),
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
    /* 🔴 This block used to claim FirebaseUI had been dropped (docs/19-qa-log.md Q17/R7) along
       with the firebase/compat shim it requires. That removal was REVERSED — `firebaseui@6.1.0`
       is a dependency of this package and `src/auth/FirebaseUIMount.tsx` imports
       `firebase/compat/app`, `firebase/compat/auth`, `firebaseui` and its stylesheet. The
       comment outlived the decision it described, which is worse than no comment: it is why
       "is /login split out?" read as already-answered.

       Nothing needs pre-bundling here — Vite crawls all four specifiers like any other
       dependency — but they are NOT split, and `SignInScreen` is imported eagerly by
       `routes.tsx`, so they land in the main chunk for every user.
       See checklists/phase-09-polish-pwa.md §6. */
  },

  build: {
    target: 'es2022',
    sourcemap: true,
    /* Deliberately below the NFR-2 ceiling: the warning should fire while there is
       still headroom, not once the budget is already blown. */
    chunkSizeWarningLimit: 300,
  },
}));
