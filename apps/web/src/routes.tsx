/**
 * The route table, derived from `ROUTE_PATTERNS` rather than written out by hand.
 *
 * Deriving it is the point. docs/07 declares the route table once, `paths.ts` mirrors it as
 * `ROUTE_PATTERNS`, and mapping over that object's keys means a screen added there without a
 * route here is impossible — the two cannot drift, because there is only one list.
 *
 * ## The shape
 *
 * ```
 * /                      → redirect to the default tab
 * <RedirectIfAuthed>     → /login only                    (AC-A1.6)
 * <RequireAuth>          → everything else                (AC-A1.5)
 *    ├── /invite/:token  → no tab bar
 *    └── <AppShell>      → the tabbed app
 * *                      → redirect to the default tab
 * ```
 *
 * Both guards are **layout routes**, so membership is structural: a screen is inside
 * `<RequireAuth>` or outside it, and which one is visible in the shape of this file rather
 * than in a wrapper somebody has to remember to write. See `auth/AuthGuards.tsx` for why the
 * guard waits on a third state instead of treating "no user yet" as "signed out".
 *
 * ## Which routes sit inside the shell
 *
 * `<AppShell>` supplies the phone column and the tab bar, so anything rendered inside it is
 * a tabbed, signed-in screen. Two routes deliberately sit OUTSIDE it:
 *
 *   * `SignIn` — there is nothing to navigate to yet, and a tab bar on a sign-in screen
 *     invites taps that would only bounce back.
 *   * `JoinGroup` — an invite link is opened by someone who may not have an account. It has
 *     to render before the tabbed app exists for them.
 *
 * Everything else is inside, which is also why the list is an exclusion set rather than an
 * inclusion one: a new screen defaults to being part of the app, and opting out is the
 * decision that has to be made explicitly.
 *
 * 🔴 `JoinGroup` is outside the **shell** but inside the **auth guard**. AC-A1.5 is "any route
 * other than `/login`", with no carve-out, and AC-B3.3 spells out what an invite is supposed to
 * do while logged out: route to sign-in, then complete the join. The guard stashes
 * `/invite/:token` on the way past, so that is exactly what happens.
 */

import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';

import { RedirectIfAuthed, RequireAuth } from './auth/AuthGuards';
import { AppShell } from './navigation/AppShell';
import { ROUTE_PATTERNS, paths, type ScreenName } from './navigation/paths';
import { AccountScreen } from './screens/AccountScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { AddExpenseScreen } from './screens/AddExpenseScreen';
import { AddFriendScreen } from './screens/AddFriendScreen';
import { CreateGroupScreen } from './screens/CreateGroupScreen';
import { EditExpenseScreen } from './screens/EditExpenseScreen';
import { EditProfileScreen } from './screens/EditProfileScreen';
import { ExpenseDetailScreen } from './screens/ExpenseDetailScreen';
import { FriendDetailScreen } from './screens/FriendDetailScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { GroupBalancesScreen } from './screens/GroupBalancesScreen';
import { GroupDetailScreen } from './screens/GroupDetailScreen';
import { GroupMembersScreen } from './screens/GroupMembersScreen';
import { GroupSettingsScreen } from './screens/GroupSettingsScreen';
import { GroupsScreen } from './screens/GroupsScreen';
import { JoinGroupScreen } from './screens/JoinGroupScreen';
import { SettleUpScreen } from './screens/SettleUpScreen';
import { SignInScreen } from './screens/SignInScreen';

/** Rendered without the tab bar. See the note above before adding to this. */
const OUTSIDE_SHELL: ReadonlySet<ScreenName> = new Set<ScreenName>(['SignIn', 'JoinGroup']);

const screenNames = Object.keys(ROUTE_PATTERNS) as ScreenName[];

/**
 * Every screen, bound to its pattern.
 *
 * 🔴 The type is a **total** `Record`, which is what finally makes `paths.ts`'s claim true: "a
 * missing screen is a compile error". It was `Partial` while the screens landed one at a time,
 * with the gaps rendering a `PendingScreen` placeholder — `JoinGroup` was the last of them, so
 * that file is gone and the hole it covered is now closed by the compiler instead.
 *
 * Adding a pattern to `ROUTE_PATTERNS` without a screen here no longer ships a "not built yet"
 * page; it fails to build, which is the right moment to find out.
 */
const SCREENS: Record<ScreenName, ComponentType> = {
  SignIn: SignInScreen,
  JoinGroup: JoinGroupScreen,
  ActivityFeed: ActivityScreen,
  GroupList: GroupsScreen,
  CreateGroup: CreateGroupScreen,
  GroupDetail: GroupDetailScreen,
  GroupMembers: GroupMembersScreen,
  GroupSettings: GroupSettingsScreen,
  GroupBalances: GroupBalancesScreen,
  SettleUp: SettleUpScreen,
  AddExpense: AddExpenseScreen,
  ExpenseDetail: ExpenseDetailScreen,
  EditExpense: EditExpenseScreen,
  FriendList: FriendsScreen,
  FriendDetail: FriendDetailScreen,
  AddFriend: AddFriendScreen,
  Account: AccountScreen,
  EditProfile: EditProfileScreen,
};

const routeFor = (name: ScreenName): RouteObject => {
  const Screen = SCREENS[name];
  return { path: ROUTE_PATTERNS[name], element: <Screen /> };
};

/** Guarded, no tab bar — `JoinGroup` today, and anything else that opts out of the shell. */
const outsideShell = screenNames.filter((name) => OUTSIDE_SHELL.has(name) && name !== 'SignIn');

/**
 * Stable ids for the three pathless layout routes.
 *
 * Named rather than anonymous because "which layout wraps this URL?" is now a real question
 * with three possible answers, and `matchRoutes` reports a pathless route only as
 * `path === undefined`. Before the guards existed there was exactly one pathless route and
 * that was enough to identify it; with three, a test asserting "renders inside the shell"
 * would pass for a screen wrapped only by a guard.
 */
export const ROUTE_IDS = {
  shell: 'app-shell',
  requireAuth: 'require-auth',
  redirectIfAuthed: 'redirect-if-authed',
} as const;

export const router = createBrowserRouter([
  // `/` is not a screen — it is a redirect into the default tab, so a bare visit to the
  // origin lands somewhere real instead of on the catch-all. It passes through the guard on
  // the way, so a signed-out visitor still ends up at `/login`.
  { path: '/', element: <Navigate to={paths.GroupList()} replace /> },

  {
    id: ROUTE_IDS.redirectIfAuthed,
    element: <RedirectIfAuthed />,
    children: [routeFor('SignIn')],
  },

  {
    id: ROUTE_IDS.requireAuth,
    element: <RequireAuth />,
    children: [
      ...outsideShell.map(routeFor),
      {
        id: ROUTE_IDS.shell,
        element: <AppShell />,
        children: screenNames.filter((name) => !OUTSIDE_SHELL.has(name)).map(routeFor),
      },
    ],
  },

  // Unknown URL. Redirects rather than rendering a 404 screen: hosting rewrites every path
  // to index.html, so a typo and a stale link both arrive here, and neither is worth a
  // dead end this early.
  { path: '*', element: <Navigate to={paths.GroupList()} replace /> },
]);
