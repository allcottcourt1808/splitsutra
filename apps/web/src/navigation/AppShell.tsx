/**
 * <AppShell> — the layout route every tabbed screen renders inside.
 *
 * ```
 * ┌────────────────────────────────┐
 * │  Header (owned by the screen)  │  <- <Screen header={…}>, not this file
 * ├────────────────────────────────┤
 * │  <Outlet />        flex: 1     │
 * ├────────────────────────────────┤
 * │  <TabBar />                    │
 * └────────────────────────────────┘
 * ```
 *
 * The header is deliberately NOT here. docs/07 calls it "Header (contextual)" — it differs
 * per screen (a title, a back button, an avatar stack, a settings icon), so each screen
 * passes its own to `<Screen header={…}>` and the shell owns only the chrome that is
 * constant: the phone column and the tab bar.
 *
 * Height comes from the flex chain `html → body → #root → .viewport → .column`, never from
 * `100vh` (docs/02 §contract rule 3).
 *
 * `<ScrollRestoration />` is not used: this app scrolls inside `.screenBody`, not on the
 * document, so React Router's document-level restoration has nothing to restore.
 * TODO(phase-04): per-route scroll restoration on the screen body
 *   (checklists/phase-04-design-system.md §3, 🟡).
 */

import { Outlet } from 'react-router';
import styles from './navigation.module.css';
import { TabBar } from './TabBar';

export function AppShell() {
  return (
    <div className={styles.viewport}>
      <div className={styles.column}>
        <div className={styles.content}>
          <Outlet />
        </div>
        <TabBar />
      </div>
    </div>
  );
}
