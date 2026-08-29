/**
 * One concrete URL per screen, built through `paths` rather than typed out by hand.
 *
 * The `Record<ScreenName, string>` annotation is the point: a screen added to
 * `ROUTE_PATTERNS` without an entry here is a compile error, so the tests that iterate this
 * map keep covering the *whole* route table rather than whichever part of it existed on the
 * day they were written.
 */

import { paths, type ScreenName } from '../../navigation/paths';

export const SAMPLE_URLS: Readonly<Record<ScreenName, string>> = {
  SignIn: paths.SignIn(),
  JoinGroup: paths.JoinGroup({ token: 'inv_abc' }),
  GroupList: paths.GroupList(),
  CreateGroup: paths.CreateGroup(),
  GroupDetail: paths.GroupDetail({ gid: 'g1' }),
  GroupSettings: paths.GroupSettings({ gid: 'g1' }),
  GroupMembers: paths.GroupMembers({ gid: 'g1' }),
  SettleUp: paths.SettleUp({ gid: 'g1' }),
  GroupBalances: paths.GroupBalances({ gid: 'g1' }),
  AddExpense: paths.AddExpense(),
  ExpenseDetail: paths.ExpenseDetail({ gid: 'g1', eid: 'e1' }),
  EditExpense: paths.EditExpense({ gid: 'g1', eid: 'e1' }),
  FriendList: paths.FriendList(),
  AddFriend: paths.AddFriend(),
  FriendDetail: paths.FriendDetail({ uid: 'u1' }),
  ActivityFeed: paths.ActivityFeed(),
  Account: paths.Account(),
  EditProfile: paths.EditProfile(),
};

export const SCREEN_NAMES: readonly ScreenName[] = Object.keys(SAMPLE_URLS) as ScreenName[];
