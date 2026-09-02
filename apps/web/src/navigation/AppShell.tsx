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

import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import styles from './navigation.module.css';
import { TabBar } from './TabBar';

/**
 * The phone column, without deciding what goes in it.
 *
 * `.viewport` centres, `.column` caps the width at `--splitsutra-size-content-max-width`
 * (640px) — docs/07 §Responsive: "full-bleed below 640px, a centred 640px column above it.
 * The app is a phone app that happens to run in a browser."
 *
 * 🔴 Extracted because the column was welded to the tab bar, and the two are not the same
 * decision. `<AppShell>` supplied both, so the screens that opt OUT of the tab bar —
 * `SignIn` and `JoinGroup`, the `OUTSIDE_SHELL` set in routes.tsx — silently opted out of
 * the column as well and rendered full-bleed. On a desktop viewport that was visible as
 * misalignment rather than as a missing constraint: `/login`'s heading sat hard against the
 * left edge of a 1600px window while FirebaseUI's own container, which centres itself, sat
 * in the middle. Two elements on the same screen obeying two different ideas of where the
 * page is. Nothing looked wrong on a phone, which is where it was always tested.
 */
function PhoneColumn({ children }: { children: ReactNode }) {
  return (
    <div className={styles.viewport}>
      <div className={styles.column}>{children}</div>
    </div>
  );
}

export function AppShell() {
  return (
    <PhoneColumn>
      <div className={styles.content}>
        <Outlet />
      </div>
      <TabBar />
    </PhoneColumn>
  );
}

/**
 * The same column with no tab bar — for the guarded screens that are not a tab.
 *
 * A screen reached by deep link (`/invite/:token`) or before there is a session (`/login`)
 * has nowhere for a tab bar to navigate to, but it is still the same app on the same
 * viewport and belongs in the same column.
 */
export function PlainShell() {
  return (
    <PhoneColumn>
      <div className={styles.content}>
        <Outlet />
      </div>
    </PhoneColumn>
  );
}
