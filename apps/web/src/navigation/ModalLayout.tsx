/**
 * <ModalLayout> — the layout route every modal screen renders inside.
 *
 * docs/07: "Modals are full-screen sheets on mobile widths and centred dialogs >= 768px.
 * On web they are real routes so back/forward and deep links work; React Navigation models
 * them as a modal stack."
 *
 * Two consequences of "real routes", both deliberate:
 *
 *   1. **No tab bar.** A modal is presented over the app, so the shell's chrome is not
 *     rendered. This is what `presentation: 'modal'` does in a React Navigation stack, and
 *     it is why the modal routes are siblings of `<AppShell>` in `routes.tsx` rather than
 *     children of it.
 *
 *   2. **No scrim over the previous screen.** Rendering the underlying route behind the
 *     dialog would need React Router's background-location trick, which has no React
 *     Navigation equivalent and would be thrown away in Phase 12. A full-screen sheet on a
 *     phone covers the previous screen anyway; the desktop dialog sits on the page
 *     background instead of a dimmed snapshot.
 *     TODO(phase-09): decide whether the >= 768px case is worth a background location
 *       (checklists/phase-09-polish-pwa.md §4 "Responsive").
 */

import { Outlet } from 'react-router';
import styles from './navigation.module.css';

export function ModalLayout() {
  return (
    <div className={styles.modalViewport}>
      {/* `dialog` + `aria-modal` so assistive tech treats the route as a modal even though
          it is a page, not a `<dialog>` element. The accessible name comes from the
          screen's own <ModalHeader>, which labels itself. */}
      <div className={styles.modalPanel} role="dialog" aria-modal="true">
        <Outlet />
      </div>
    </div>
  );
}
