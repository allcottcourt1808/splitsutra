/**
 * `/invite/:token`.
 *
 * 🔴 Article III/IV again: a client cannot add itself to a group, so there is no write for a
 * test to observe. The whole contract is "the callable is invoked with this token, and each
 * answer it can give is rendered distinctly" — AC-B3.5 asks for a specific message per failure
 * case, and the messages come from the Function, so the assertion that matters is that they are
 * shown rather than replaced.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';

import { render } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { JoinGroupScreen } from '../JoinGroupScreen';

const state = vi.hoisted(() => ({ redeemInvite: vi.fn() }));

vi.mock('@splitsutra/core/repositories', () => ({
  redeemInvite: (...args: unknown[]) => state.redeemInvite(...args) as Promise<unknown>,
}));

/** 32 lowercase hex characters, as `inviteSchema.token` requires. */
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/**
 * A rejection shaped like the real thing: a `FirebaseError` carrying `code: 'functions/<status>'`
 * alongside the message. Verified against the dev project — a bare `Error` with only a message is
 * not what a callable ever throws, and testing against that shape is what let a raw status code
 * reach the screen in the first place.
 */
function callableError(status: string, message: string): Error {
  return Object.assign(new Error(message), { code: `functions/${status}`, name: 'FirebaseError' });
}

const routes: RouteObject[] = [{ path: '/invite/:token', element: <JoinGroupScreen /> }];

function visit(token: string = TOKEN): HTMLElement {
  const memory = createMemoryRouter(routes, { initialEntries: [`/invite/${token}`] });
  return render(<RouterProvider router={memory} />).container;
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (el) => (el.textContent ?? '').trim() === name || el.getAttribute('aria-label') === name,
  );
  if (found === undefined) throw new Error(`No button named "${name}"`);
  return found;
}

async function press(container: HTMLElement, name: string): Promise<void> {
  const target = button(container, name);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.redeemInvite = vi
    .fn()
    .mockResolvedValue({ groupId: 'g1', groupName: 'Goa Trip', alreadyMember: false });
});

describe('<JoinGroupScreen>', () => {
  it('does not join until asked', () => {
    visit();

    // Redeeming on mount would make opening a link the same as accepting it.
    expect(state.redeemInvite).not.toHaveBeenCalled();
  });

  it('joins with the token from the URL', async () => {
    const container = visit();

    await press(container, 'Join group');

    expect(state.redeemInvite).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('names the group only once the server has vouched for it', async () => {
    const container = visit();
    // Nothing about the group is knowable before the join — invites deny every client read.
    expect(container.textContent).not.toContain('Goa Trip');

    await press(container, 'Join group');

    expect(container.textContent).toContain('You joined Goa Trip');
  });

  it('links onward to the group it just joined', async () => {
    const container = visit();

    await press(container, 'Join group');

    const link = container.querySelector(`a[href="${paths.GroupDetail({ gid: 'g1' })}"]`);
    expect(link).not.toBeNull();
  });

  it('does not claim you joined when you were already a member', async () => {
    state.redeemInvite = vi
      .fn()
      .mockResolvedValue({ groupId: 'g1', groupName: 'Goa Trip', alreadyMember: true });
    const container = visit();

    await press(container, 'Join group');

    // Idempotent success, per docs/06 step 4 — but saying "You joined" would be a lie.
    expect(container.textContent).toContain('already in Goa Trip');
    expect(container.textContent).not.toContain('You joined');
  });

  it('rejects a malformed token without calling the server', () => {
    const container = visit('not-a-token');

    expect(state.redeemInvite).not.toHaveBeenCalled();
    expect(container.textContent).toContain('not valid');
  });

  it.each([
    ['deadline-exceeded', 'This invite link has expired.'],
    ['failed-precondition', 'This invite link has already been used or revoked.'],
    ['resource-exhausted', 'This group is full (50 members).'],
    ['not-found', 'That group no longer exists.'],
  ])('shows the failure the server gave, verbatim: %s', async (status, message) => {
    state.redeemInvite = vi.fn().mockRejectedValue(callableError(status, message));
    const container = visit();

    await press(container, 'Join group');

    // AC-B3.5. These strings are written to be read by a user; replacing them with one generic
    // apology is the exact thing the criterion rules out.
    expect(container.textContent).toContain(message);
  });

  it.each([
    // 🔴 The case that reached the browser: with the Functions undeployed the call rejects as
    // `functions/internal` with the message `internal [0]`, and passing every message through
    // put exactly that on screen. Not the invite's fault, and not wording meant for a reader.
    ['internal', 'internal [0]'],
    ['unavailable', 'unavailable'],
    ['unauthenticated', 'unauthenticated'],
  ])('does not show a raw %s status to the user', async (status, message) => {
    state.redeemInvite = vi.fn().mockRejectedValue(callableError(status, message));
    const container = visit();

    await press(container, 'Join group');

    expect(container.textContent).not.toContain(message);
    expect(container.textContent).toContain('Check your connection');
  });

  it('falls back to a readable message when the failure carries none', async () => {
    state.redeemInvite = vi.fn().mockRejectedValue(new Error(''));
    const container = visit();

    await press(container, 'Join group');

    expect(container.textContent).toContain('Check your connection');
  });

  it('lets you retry after a failure', async () => {
    state.redeemInvite = vi
      .fn()
      .mockRejectedValue(callableError('deadline-exceeded', 'This invite link has expired.'));
    const container = visit();
    await press(container, 'Join group');

    state.redeemInvite = vi
      .fn()
      .mockResolvedValue({ groupId: 'g1', groupName: 'Goa Trip', alreadyMember: false });
    await press(container, 'Join group');

    expect(container.textContent).toContain('You joined Goa Trip');
  });
});
