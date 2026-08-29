/**
 * Reading a stylesheet as TEXT from a test, and parsing which `@layer` each rule sits in.
 *
 * WHY READ OFF DISK. Vitest routes every `.css` specifier through its CSS-modules handling
 * and hands back the class-name proxy no matter what query you append, so `?raw` yields an
 * object that throws on Symbol access rather than the source text. Reading the file is the
 * only way a test can see the declarations at all.
 *
 * WHY THE PATH DANCE. `import.meta.url` is a URL, not a path: `fileURLToPath` rejects the
 * http form vitest can serve, and the pathname arrives on Windows with a leading slash in
 * front of the drive letter, which `readFileSync` will not accept.
 *
 * 🔴 AND WHY `node:path` RATHER THAN `new URL(relative, import.meta.url)`. The `component`
 * project runs in happy-dom, which installs its own `URL` over the native one, and that
 * polyfill does not resolve RELATIVE references correctly against a `file:` base — it
 * silently drops the leading directories, so `../../components/x.css` came back as
 * `/src/x.css` and `readFileSync` then failed on a path that looks plausible in the error
 * message. Parsing an ABSOLUTE url still works, so `import.meta.url` goes through `URL`
 * once and every join after that is `node:path`.
 *
 * WHY A PARSER AND NOT A REGEX. `@layer` bodies nest, and so do `@media` blocks, so the
 * only way to know whether a rule is layered is to track brace depth. A regex over
 * `\.foo\s*\{` cannot tell `.tab` inside a layer from `.tab` outside one, which is the
 * single fact `cascadeLayers.test.tsx` exists to check.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** This file's own directory, as a real filesystem path. */
function helperDir(): string {
  const raw = decodeURIComponent(new URL(import.meta.url).pathname);
  const looksWindows = raw.charAt(0) === '/' && raw.charAt(2) === ':';
  return dirname(looksWindows ? raw.slice(1) : raw);
}

/** `apps/web/src/` — this file lives at `apps/web/src/__tests__/helpers/`. */
const SRC_ROOT = resolve(helperDir(), '..', '..');

/** A path under `apps/web/src/`, e.g. `components/controls.module.css`. */
export function readCss(relativeToSrc: string): string {
  return readFileSync(resolve(SRC_ROOT, relativeToSrc), 'utf8');
}

export interface CssRule {
  /** One selector from the rule's (possibly comma-separated) prelude, whitespace-collapsed. */
  readonly selector: string;
  /** Declared property names. Shorthands are NOT expanded — see the note in the test. */
  readonly properties: ReadonlySet<string>;
  /** The innermost `@layer` name this rule sits in, or `null` when it is unlayered. */
  readonly layer: string | null;
}

/**
 * Every rule in a stylesheet, flattened, each tagged with the layer it belongs to.
 * `@media` and other at-blocks are walked through — they do not change layer membership.
 */
export function parseCss(source: string): readonly CssRule[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;

  function walk(layer: string | null): void {
    while (i < src.length) {
      if (src[i] === '}') {
        i += 1;
        return;
      }
      const start = i;
      while (i < src.length && src[i] !== '{' && src[i] !== '}') i += 1;
      if (i >= src.length) return;
      if (src[i] === '}') {
        i += 1;
        return;
      }

      const prelude = src.slice(start, i).trim().replace(/\s+/g, ' ');
      i += 1; // past `{`

      if (prelude.startsWith('@')) {
        const named = /^@layer\s+([\w-]+)/.exec(prelude);
        walk(named === null ? layer : (named[1] ?? layer));
        continue;
      }

      const bodyStart = i;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') depth -= 1;
        if (depth > 0) i += 1;
      }
      const body = src.slice(bodyStart, i);
      i += 1; // past `}`

      const properties = new Set(
        body
          .split(';')
          .map((declaration) => declaration.split(':')[0]?.trim() ?? '')
          .filter((name) => name.length > 0),
      );

      for (const selector of prelude.split(',').map((s) => s.trim())) {
        rules.push({ selector, properties, layer });
      }
    }
  }

  walk(null);
  return rules;
}

/** Every rule whose prelude is exactly `selector`. Empty when the rule was renamed. */
export function rulesFor(rules: readonly CssRule[], selector: string): readonly CssRule[] {
  return rules.filter((rule) => rule.selector === selector);
}
