/**
 * Route patterns, typed path builders, and the tab descriptors.
 *
 * Contract rule 5 (docs/02): "Navigation via a route table. All routes declared in one file
 * with typed params. React Navigation consumes the same shape."
 *
 * This module is the DATA half of that table — plain strings and types, zero React, zero
 * screen imports. `../routes.tsx` is the React half: it binds each pattern to its screen
 * component. Splitting it this way is what lets a screen import `paths` to build a link
 * without creating a cycle back through the screen it is linking to.
 *
 * Phase 12 keeps {@link RouteParamMap} verbatim as the React Navigation `ParamList` and
 * replaces the builders below with `navigation.navigate('GroupDetail', { gid })`.
 * Nothing else in a screen changes.
 *
 * @see docs/07-ui-ux-spec.md §Route table
 * @see checklists/phase-04-design-system.md §3
 */

/* -------------------------------------------------------------------------- */
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The React Router path patterns, exactly as the docs/07 route table declares them.
 *
 * Keys are the SCREEN names from that table, so the table, this object, {@link paths},
 * {@link RouteParamMap} and the files in `src/screens/` all line up one-to-one and a
 * missing screen is a compile error.
 */
export const ROUTE_PATTERNS = {
  SignIn: '/login',
  JoinGroup: '/invite/:token',
  GroupList: '/groups',
  CreateGroup: '/groups/new',
  GroupDetail: '/groups/:gid',
  GroupSettings: '/groups/:gid/settings',
  GroupMembers: '/groups/:gid/members',
  SettleUp: '/groups/:gid/settle',
  GroupBalances: '/groups/:gid/balances',
  AddExpense: '/expense/new',
  ExpenseDetail: '/expense/:gid/:eid',
  EditExpense: '/expense/:gid/:eid/edit',
  FriendList: '/friends',
  AddFriend: '/friends/add',
  FriendDetail: '/friends/:uid',
  ActivityFeed: '/activity',
  Account: '/account',
  EditProfile: '/account/profile',
} as const;

export type ScreenName = keyof typeof ROUTE_PATTERNS;

/**
 * Params each screen takes.
 *
 * `undefined` means "no params", which is also how React Navigation spells it — this
 * interface is lifted into `apps/mobile` unchanged in Phase 12.
 */
export interface RouteParamMap {
  SignIn: undefined;
  JoinGroup: { token: string };
  GroupList: undefined;
  CreateGroup: undefined;
  GroupDetail: { gid: string };
  GroupSettings: { gid: string };
  GroupMembers: { gid: string };
  /** `to`/`amountMinor` prefill the form when arriving from a suggested payment (AC-E3.4). */
  SettleUp: { gid: string };
  GroupBalances: { gid: string };
  /**
   * `gid` preselects the group, for the "Add an expense" button on a group screen.
   *
   * A query parameter rather than a path segment because it is a PREFILL, not the identity of
   * the screen: `/expense/new` is one route whichever group it opens on, and the user may change
   * the group without the URL becoming a lie. Optional, because the Add tab opens the same
   * screen with no group in mind.
   */
  AddExpense: { gid?: string | undefined } | undefined;
  ExpenseDetail: { gid: string; eid: string };
  EditExpense: { gid: string; eid: string };
  FriendList: undefined;
  AddFriend: undefined;
  FriendDetail: { uid: string };
  ActivityFeed: undefined;
  Account: undefined;
  EditProfile: undefined;
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A path segment is user-controlled data (a group id, an invite token), so it is
 * percent-encoded. A group id never contains `/`, but an invite token arriving from a
 * pasted URL is untrusted input and must not be able to invent a path segment.
 */
function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Build a URL for a screen. **The only sanctioned way to write a link** — no screen
 * concatenates a route string by hand, so renaming a route is a single edit here.
 */
export const paths = {
  SignIn: (): string => ROUTE_PATTERNS.SignIn,
  JoinGroup: (p: RouteParamMap['JoinGroup']): string => `/invite/${seg(p.token)}`,
  GroupList: (): string => ROUTE_PATTERNS.GroupList,
  CreateGroup: (): string => ROUTE_PATTERNS.CreateGroup,
  GroupDetail: (p: RouteParamMap['GroupDetail']): string => `/groups/${seg(p.gid)}`,
  GroupSettings: (p: RouteParamMap['GroupSettings']): string => `/groups/${seg(p.gid)}/settings`,
  GroupMembers: (p: RouteParamMap['GroupMembers']): string => `/groups/${seg(p.gid)}/members`,
  SettleUp: (p: RouteParamMap['SettleUp']): string => `/groups/${seg(p.gid)}/settle`,
  GroupBalances: (p: RouteParamMap['GroupBalances']): string => `/groups/${seg(p.gid)}/balances`,
  AddExpense: (p?: RouteParamMap['AddExpense']): string =>
    p?.gid === undefined
      ? ROUTE_PATTERNS.AddExpense
      : // `URLSearchParams` rather than a template, so a group id needing escaping cannot
        // invent a second parameter. Same reasoning as `seg` above, for the query half.
        `${ROUTE_PATTERNS.AddExpense}?${new URLSearchParams({ gid: p.gid }).toString()}`,
  ExpenseDetail: (p: RouteParamMap['ExpenseDetail']): string =>
    `/expense/${seg(p.gid)}/${seg(p.eid)}`,
  EditExpense: (p: RouteParamMap['EditExpense']): string =>
    `/expense/${seg(p.gid)}/${seg(p.eid)}/edit`,
  FriendList: (): string => ROUTE_PATTERNS.FriendList,
  AddFriend: (): string => ROUTE_PATTERNS.AddFriend,
  FriendDetail: (p: RouteParamMap['FriendDetail']): string => `/friends/${seg(p.uid)}`,
  ActivityFeed: (): string => ROUTE_PATTERNS.ActivityFeed,
  Account: (): string => ROUTE_PATTERNS.Account,
  EditProfile: (): string => ROUTE_PATTERNS.EditProfile,
} as const;

/** Where `/` lands. docs/07 marks GroupList as **Home**. */
export const HOME_PATH: string = ROUTE_PATTERNS.GroupList;

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

export type TabKey = 'groups' | 'friends' | 'add' | 'activity' | 'account';

export interface TabDescriptor {
  readonly key: TabKey;
  /** Visible label. Also the accessible name — icons alone never identify a tab (NFR-4). */
  readonly label: string;
  readonly path: string;
  /**
   * The prefix that marks this tab current. `/groups/xyz/settle` still lights up Groups,
   * which is how a bottom tab bar is expected to behave.
   */
  readonly match: string;
  /**
   * The raised centre button. docs/07: "it is an action, not a destination" — it opens the
   * Add Expense modal rather than switching tab, and never renders as the current tab.
   */
  readonly raised: boolean;
}

/**
 * Five destinations, in docs/07's order: Groups · Friends · **Add** · Activity · Account.
 * Maps 1:1 onto `createBottomTabNavigator` in Phase 12.
 */
export const TABS: readonly TabDescriptor[] = [
  { key: 'groups', label: 'Groups', path: paths.GroupList(), match: '/groups', raised: false },
  { key: 'friends', label: 'Friends', path: paths.FriendList(), match: '/friends', raised: false },
  { key: 'add', label: 'Add', path: paths.AddExpense(), match: '/expense', raised: true },
  {
    key: 'activity',
    label: 'Activity',
    path: paths.ActivityFeed(),
    match: '/activity',
    raised: false,
  },
  { key: 'account', label: 'Account', path: paths.Account(), match: '/account', raised: false },
];

/** `true` when `pathname` sits inside `tab`'s section. Segment-aware, so `/groupsomething` misses. */
export function isTabActive(tab: TabDescriptor, pathname: string): boolean {
  if (tab.raised) return false;
  return pathname === tab.match || pathname.startsWith(`${tab.match}/`);
}
