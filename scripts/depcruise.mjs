/**
 * Run dependency-cruiser over whichever source roots are actually present.
 *
 * WHY THIS IS NOT JUST `depcruise packages apps firebase/functions`:
 *
 * dependency-cruiser exits 1 with "Can't open '<dir>' for reading" if any argument is
 * missing, and the three roots do not all exist on every branch — the workspace is split
 * across feature branches, so `chore/workspace-toolchain` has none of them and each code
 * branch has only its own. That turned a green tree into a red CI on all four PRs.
 *
 * WHY NOT `depcruise .` INSTEAD:
 *
 * Because the rules depend on node_modules being reachable. The FirebaseUI ban matches
 * `node_modules/firebaseui`, so excluding node_modules to make a whole-repo cruise
 * tolerable would silently stop that rule ever firing — the rule would still be listed,
 * still be severity: error, and never catch anything. A rule that cannot fail is worse
 * than no rule, because it reads as coverage.
 *
 * So: cruise the real roots, and only the ones that are there.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOTS = ['packages', 'apps', 'firebase/functions'];
const present = ROOTS.filter((root) => existsSync(root));
const missing = ROOTS.filter((root) => !present.includes(root));

if (present.length === 0) {
  console.log('depcruise: none of [%s] exist here — nothing to cruise.', ROOTS.join(', '));
  process.exit(0);
}

if (missing.length > 0) {
  console.log('depcruise: skipping absent root(s): %s', missing.join(', '));
}
console.log('depcruise: cruising %s\n', present.join(', '));

const result = spawnSync('depcruise', [...present, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
