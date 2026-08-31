/**
 * "With you and …" — choosing who an expense is with.
 *
 * ## Why this is not a row of chips any more
 *
 * It was, and the chips were fine at three. `watchExpenseGroups` returns up to
 * `MY_GROUPS_PAGE_SIZE` (50) entries and includes every hidden 1:1 friend group, so the picker
 * grows with the friend list as well as the group list — and an implicit group is named
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
 * `isImplicit` is the difference between "Sandeep" and "the Goa trip", and flattening the two
 * into one list makes the reader do that sorting themselves on every search. The sections cost
 * nothing — the flag is already on the document.
 */

import { useMemo, useState } from 'react';

import type { Group, GroupType } from '@splitsutra/core';

import { Avatar } from '../../components/Avatar';
import { Card, Row, Stack } from '../../components/Layout';
import { Input } from '../../components/Input';
import { List } from '../../components/List';
import { ListRow } from '../../components/ListRow';
import { Text } from '../../components/Text';

/** Matches `TYPE_LABEL` in GroupDetailScreen — `friend` never reaches it, see `displayName`. */
const TYPE_LABEL: Readonly<Record<GroupType, string>> = {
  trip: 'Trip',
  home: 'Home',
  friends: 'Friends',
  other: 'Group',
  friend: 'Friend',
  couple: 'Couple',
};

/**
 * What to call this group on screen.
 *
 * An implicit group is stored as `"<creator> & <other>"` (`implicitGroupName`), so for a 1:1 the
 * reader's own name is half the label and carries no information — "Sandeep Tharayil & Neethu
 * Sandeep" says "Sandeep" in a row twice as wide.
 *
 * 🔴 Only an EXACT match of the viewer's own name is stripped, at either end, and anything else
 *    falls through to the stored name unchanged. Splitting on `" & "` would be shorter and wrong:
 *    a display name may itself contain an ampersand, and `implicitGroupName` truncates the join
 *    at 60 characters, so the second name can be cut mid-word. Both cases simply fail to match
 *    here and show the full stored name, which is never *wrong* — only long.
 */
export function displayName(group: Group, selfName: string): string {
  if (!group.isImplicit || selfName.length === 0) return group.name;

  const prefix = `${selfName} & `;
  if (group.name.startsWith(prefix)) return group.name.slice(prefix.length);

  const suffix = ` & ${selfName}`;
  if (group.name.endsWith(suffix)) return group.name.slice(0, -suffix.length);

  return group.name;
}

/** The line under the name. A 1:1 needs no member count — "2 members" is both of you. */
function subtitleFor(group: Group): string {
  if (group.isImplicit) return `Friend · ${group.currency}`;
  const members = `${String(group.memberCount)} ${group.memberCount === 1 ? 'member' : 'members'}`;
  return `${TYPE_LABEL[group.type]} · ${members} · ${group.currency}`;
}

export interface GroupPickerProps {
  readonly groups: readonly Group[];
  readonly selectedId: string | null;
  readonly onSelect: (groupId: string) => void;
  /** The viewer's own display name, used to shorten 1:1 labels. `''` disables the shortening. */
  readonly selfName: string;
}

export function GroupPicker({ groups, selectedId, onSelect, selfName }: GroupPickerProps) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const selected = groups.find((group) => group.id === selectedId) ?? null;

  /**
   * Filtered on the name the reader can SEE, not the stored one.
   *
   * Searching the stored name would mean typing your own name matches every 1:1 group, and that
   * a friend whose name was truncated out of the label is unfindable by the label shown.
   */
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return groups;
    return groups.filter((group) => displayName(group, selfName).toLowerCase().includes(needle));
  }, [groups, query, selfName]);

  const people = matches.filter((group) => group.isImplicit);
  const realGroups = matches.filter((group) => !group.isImplicit);

  const choose = (groupId: string): void => {
    onSelect(groupId);
    // Choosing is the only reason the list is open. Leaving it open buries the amount field
    // again, which is the whole thing this component exists to stop.
    setPicking(false);
    setQuery('');
  };

  const row = (group: Group) => (
    <ListRow
      title={displayName(group, selfName)}
      subtitle={group.id === selectedId ? 'Selected' : subtitleFor(group)}
      leading={
        <Avatar name={displayName(group, selfName)} photoURL={group.photoURL} size="avatarSm" />
      }
      chevron={false}
      trailing={
        group.id === selectedId ? (
          <Text aria-hidden tone="primary">
            ✓
          </Text>
        ) : undefined
      }
      label={
        group.id === selectedId
          ? `${displayName(group, selfName)}, selected`
          : `Choose ${displayName(group, selfName)}`
      }
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
            title={selected === null ? 'Choose a group or person' : displayName(selected, selfName)}
            subtitle={selected === null ? undefined : subtitleFor(selected)}
            leading={
              selected === null ? undefined : (
                <Avatar
                  name={displayName(selected, selfName)}
                  photoURL={selected.photoURL}
                  size="avatarSm"
                />
              )
            }
            label={
              selected === null
                ? 'Choose a group or person'
                : `With ${displayName(selected, selfName)}. Change it`
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
