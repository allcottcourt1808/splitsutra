/**
 * The layout route's contract, as stated in `AppShell.tsx`'s own header: the shell owns the
 * phone column and the tab bar, the screen owns its header, and the routed screen renders
 * through a single `<Outlet />`.
 *
 * Two of these are worth pinning because the failure is invisible in a diff: a shell that
 * renders its own header quietly gives every screen two of them, and a shell that renders
 * the tab bar before the outlet moves it to the top of the tab order for keyboard users.
 */

import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderAt } from '../../__tests__/helpers/render';
import { AppShell } from '../AppShell';

function shellAt(pathname: string) {
  return renderAt(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/groups" element={<p id="screen">Groups screen</p>} />
      </Route>
    </Routes>,
    pathname,
  );
}

describe('<AppShell>', () => {
  it('renders the routed screen through its outlet', () => {
    const { container } = shellAt('/groups');

    expect(container.querySelector('#screen')?.textContent).toBe('Groups screen');
  });

  it('supplies exactly one tab bar', () => {
    const { container } = shellAt('/groups');

    expect(container.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(1);
  });

  it('places the tab bar after the screen content, not before it', () => {
    const { container } = shellAt('/groups');

    const screen = container.querySelector('#screen');
    const nav = container.querySelector('nav');
    expect(screen).not.toBeNull();
    expect(nav).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the nav comes after the screen in reading and tab order.
    expect(screen!.compareDocumentPosition(nav!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('contributes no header of its own — the header belongs to the screen', () => {
    const { container } = shellAt('/groups');

    expect(container.querySelectorAll('header')).toHaveLength(0);
  });
});
