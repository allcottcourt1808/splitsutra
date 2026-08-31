/**
 * Choosing one member of a group — "Paid by", and adding a second payer.
 *
 * Same shape and same reason as {@link GroupPicker}, over a different collection. A group is
 * capped at `MAX_GROUP_MEMBERS` (50), so the wrapping chip row this replaced put up to 50 name
 * chips — ten to fifteen wrapped lines — directly above the Split card, on a screen whose whole
 * job is to get a number typed (docs/15 rule 2).
 *
 * It is also what docs/07 asked for in the first place. The Add Expense mock at
 * `docs/07-ui-ux-spec.md:112` reads `Paid by [ you ▾ ]`, and §125 says "'Paid by' opens a sheet:
 * single payer list + a 'multiple people' mode" — a dropdown onto a list, never an open row of
 * every candidate.
 *
 * Collapsing is free here for the same reason it is in `GroupPicker`: the default is already
 * right. `initialFormState` sets `singlePayerUid` to the signed-in user, and docs/15 §29 puts
 * that at roughly four cases in five.
 *
 * 🔴 Not merged with `GroupPicker` into one generic picker. They select from different types
 *    with different subtitles, different empty copy and different sectioning — a shared
 *    component would take a render prop per difference and be longer than both. If a third
 *    picker appears, extract the collapsed-row-plus-search *shell* and leave the rows here.
 */

import { useMemo, useState } from 'react';

import type { GroupMember } from '@splitsutra/core';

import { Avatar } from '../../components/Avatar';
import { Card, Stack } from '../../components/Layout';
import { Input } from '../../components/Input';
import { List } from '../../components/List';
import { ListRow } from '../../components/ListRow';
import { Text } from '../../components/Text';

export interface MemberPickerProps {
  readonly members: readonly GroupMember[];
  /** Currently chosen member, or `null` when this picker is an "add someone" action. */
  readonly selectedUid: string | null;
  readonly onSelect: (uid: string) => void;
  /** Renders a name for a uid — "You" for the signed-in user. Owned by the caller. */
  readonly nameOf: (uid: string) => string;
  /** Field label, e.g. "Paid by". Also the accessible name of the collapsed row. */
  readonly label: string;
  /** Collapsed-row text when nothing is selected. */
  readonly emptyLabel?: string | undefined;
}

export function MemberPicker({
  members,
  selectedUid,
  onSelect,
  nameOf,
  label,
  emptyLabel = 'Choose someone',
}: MemberPickerProps) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const selected = members.find((member) => member.uid === selectedUid) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return members;
    // Matched on the DISPLAYED name, so typing "you" finds yourself — the name the row shows is
    // the only one the reader can search by.
    return members.filter((member) => nameOf(member.uid).toLowerCase().includes(needle));
  }, [members, query, nameOf]);

  const choose = (uid: string): void => {
    onSelect(uid);
    setPicking(false);
    setQuery('');
  };

  if (!picking) {
    return (
      <Card flush>
        <ListRow
          title={selected === null ? emptyLabel : nameOf(selected.uid)}
          subtitle={selected === null ? undefined : label}
          leading={
            selected === null ? undefined : (
              <Avatar name={nameOf(selected.uid)} photoURL={selected.photoURL} size="avatarSm" />
            )
          }
          label={selected === null ? emptyLabel : `${label} ${nameOf(selected.uid)}. Change it`}
          onPress={() => {
            setPicking(true);
          }}
        />
      </Card>
    );
  }

  return (
    <Stack gap="sm">
      <Input
        label={`Find someone — ${label}`}
        value={query}
        onValueChange={setQuery}
        type="search"
        inputMode="search"
        placeholder="Priya, you…"
        autoFocus
        helper={
          query.trim().length === 0
            ? undefined
            : `${String(matches.length)} ${matches.length === 1 ? 'match' : 'matches'}.`
        }
      />

      {matches.length === 0 ? (
        <Card>
          <Text tone="secondary">Nobody in this group matches “{query.trim()}”.</Text>
        </Card>
      ) : (
        <Card flush>
          <List
            data={matches}
            aria-label={label}
            keyExtractor={(member) => member.uid}
            renderItem={(member) => (
              <ListRow
                title={nameOf(member.uid)}
                subtitle={member.uid === selectedUid ? 'Selected' : undefined}
                leading={
                  <Avatar name={nameOf(member.uid)} photoURL={member.photoURL} size="avatarSm" />
                }
                chevron={false}
                trailing={
                  member.uid === selectedUid ? (
                    <Text aria-hidden tone="primary">
                      ✓
                    </Text>
                  ) : undefined
                }
                label={
                  member.uid === selectedUid
                    ? `${nameOf(member.uid)}, selected`
                    : `Choose ${nameOf(member.uid)}`
                }
                onPress={() => {
                  choose(member.uid);
                }}
              />
            )}
          />
        </Card>
      )}
    </Stack>
  );
}
