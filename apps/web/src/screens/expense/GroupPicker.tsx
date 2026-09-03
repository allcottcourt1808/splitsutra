/**
 * "With you and …" — choosing who an expense is with.
 *
 * ## Why this is not a row of chips any more
 *
 * It was, and the chips were fine at three. `watchExpenseGroups` returns up to
 * `MY_GROUPS_PAGE_SIZE` (50) entries and includes every 1:1 friend group, so the picker grows
 * with the friend list as well as the group list — and a friendship is stored as
 * `"<creator> & <other>"`, which is long enough that three of them already wrapped to three
 * lines. Fifty is a screen of chips above the amount field, which is the thing docs/15 rule 2
 * calls the hero and the thing the user came here to type.
 *
 * The same problem, and the same answer, as the currency picker in `CreateGroupScreen`: collapse
 * to a summary row, open a searchable list on tap. That comparison is worth making precisely
 * because the justification is *different*. Currency collapses because almost nobody changes it.
 * Who an expense is with is the one field that always matters — so collapsing it is only
 * defensible because `AddExpenseScreen` defaults to `groups[0]`, and `watchExpenseGroups` sorts
 * by `lastActivityAt` DESC. The default is "the group you were last active in", which is usually
 * right, so the common path costs zero taps and picking something else costs two.
 *
 * 🔴 If that ordering or that default ever changes, this collapse stops being free and has to be
 *    revisited. A collapsed picker over an arbitrary default is a worse screen than the chips.
 *
 * ## People and groups are shown apart
 *
 * A friendship is the difference between "Sandeep" and "the Goa trip", and flattening the two
 * into one list makes the reader do that sorting themselves on every search. The sections cost
 * nothing — `type` is already on the document.
 *
 * What each row is CALLED is `groupLabel`, which is where the reasoning lives: a friendship's
 * stored name is half the reader's own name, and after ADR-13 promotion that name reaches the
 * Groups tab too, so the shortening could not stay a picker-local trick.
 */

import { useCallback, useMemo, useState } from 'react';

import type { Group, GroupType } from '@splitsutra/core';

import { Avatar } from '../../components/Avatar';
import { Card, Row, Stack } from '../../components/Layout';
import { Input } from '../../components/Input';
import { List } from '../../components/List';
import { ListRow } from '../../components/ListRow';
import { Text } from '../../components/Text';
import { groupLabel, isFriendship } from '../group/groupLabel';

/** Matches `TYPE_LABEL` in GroupDetailScreen — `friend` never reaches it, see `displayName`. */
const TYPE_LABEL: Readonly<Record<GroupType, string>> = {
  trip: 'Trip',
  home: 'Home',
  friends: 'Friends',
  other: 'Group',
  friend: 'Friend',
  couple: 'Couple',
};

/** The line under the name. A 1:1 needs no member count — "2 members" is both of you. */
function subtitleFor(group: Group): string {
  if (isFriendship(group)) return `Friend · ${group.currency}`;
  const members = `${String(group.memberCount)} ${group.memberCount === 1 ? 'member' : 'members'}`;
  return `${TYPE_LABEL[group.type]} · ${members} · ${group.currency}`;
}

export interface GroupPickerProps {
  readonly groups: readonly Group[];
  readonly selectedId: string | null;
  readonly onSelect: (groupId: string) => void;
  /** The viewer's own display name, used to shorten 1:1 labels. `''` disables the shortening. */
  readonly selfName: string;
  /**
   * `implicitGroupId → the friend's name`, from `useFriendshipNames`. Optional: without it a
   * friendship still labels correctly by stripping `selfName`, just not across a rename.
   */
  readonly friendNames?: ReadonlyMap<string, string> | undefined;
}

const NO_FRIEND_NAMES: ReadonlyMap<string, string> = new Map();

export function GroupPicker({
  groups,
  selectedId,
  onSelect,
  selfName,
  friendNames = NO_FRIEND_NAMES,
}: GroupPickerProps) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const selected = groups.find((group) => group.id === selectedId) ?? null;

  // Stable identity so `matches` below does not recompute on every keystroke's render.
  const label = useCallback(
    (group: Group): string =>
      groupLabel(group, { friendName: friendNames.get(group.id), selfName }),
    [friendNames, selfName],
  );

  /**
   * Filtered on the name the reader can SEE, not the stored one.
   *
   * Searching the stored name would mean typing your own name matches every 1:1 group, and that
   * a friend whose name was truncated out of the label is unfindable by the label shown.
   */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return groups;
    return groups.filter((group) => label(group).toLowerCase().includes(needle));
  }, [groups, query, label]);

  // 🔴 `isFriendship`, not `isImplicit`: ADR-13 clears the implicit flag the first time a
  //    friendship holds an expense, and a friendship you actually use is the LAST one that
  //    should slide out of "People" and start reading as a folder.
  const people = matches.filter((group) => isFriendship(group));
  const realGroups = matches.filter((group) => !isFriendship(group));

  const choose = (groupId: string): void => {
    onSelect(groupId);
    // Choosing is the only reason the list is open. Leaving it open buries the amount field
    // again, which is the whole thing this component exists to stop.
    setPicking(false);
    setQuery('');
  };

  const row = (group: Group) => (
    <ListRow
      title={label(group)}
      subtitle={group.id === selectedId ? 'Selected' : subtitleFor(group)}
      leading={<Avatar name={label(group)} photoURL={group.photoURL} size="avatarSm" />}
      chevron={false}
      trailing={
        group.id === selectedId ? (
          <Text aria-hidden tone="primary">
            ✓
          </Text>
        ) : undefined
      }
      label={group.id === selectedId ? `${label(group)}, selected` : `Choose ${label(group)}`}
      onPress={() => {
        choose(group.id);
      }}
    />
  );

  const section = (heading: string, data: readonly Group[]) =>
    data.length === 0 ? null : (
      <Stack gap="xs">
        <Text variant="caption" tone="secondary" weight="semibold">
          {heading}
        </Text>
        <Card flush>
          <List
            data={data}
            aria-label={heading}
            keyExtractor={(group) => group.id}
            renderItem={row}
          />
        </Card>
      </Stack>
    );

  return (
    <Stack gap="sm">
      <Text variant="caption" tone="secondary" weight="semibold">
        With you and
      </Text>

      {!picking && (
        <Card flush>
          <ListRow
            title={selected === null ? 'Choose a group or person' : label(selected)}
            subtitle={selected === null ? undefined : subtitleFor(selected)}
            leading={
              selected === null ? undefined : (
                <Avatar name={label(selected)} photoURL={selected.photoURL} size="avatarSm" />
              )
            }
            label={
              selected === null ? 'Choose a group or person' : `With ${label(selected)}. Change it`
            }
            onPress={() => {
              setPicking(true);
            }}
          />
        </Card>
      )}

      {picking && (
        <Input
          label="Find a group or person"
          value={query}
          onValueChange={setQuery}
          type="search"
          inputMode="search"
          placeholder="Goa trip, Priya…"
          autoFocus
          helper={
            query.trim().length === 0
              ? 'Most recently used first. Type to search them all.'
              : `${String(matches.length)} ${matches.length === 1 ? 'match' : 'matches'}.`
          }
        />
      )}

      {picking && matches.length === 0 && (
        <Card>
          <Text tone="secondary">
            Nothing matches “{query.trim()}”. Groups you have left do not appear here.
          </Text>
        </Card>
      )}

      {picking && (
        <>
          {section('People', people)}
          {section('Groups', realGroups)}
        </>
      )}

      {picking && (
        <Row justify="end">
          <Text variant="caption" tone="secondary">{`${String(groups.length)} in total`}</Text>
        </Row>
      )}
    </Stack>
  );
}
