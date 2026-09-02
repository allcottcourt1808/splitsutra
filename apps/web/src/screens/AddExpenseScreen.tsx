/**
 * `/expense/new` — the raised centre tab.
 *
 * docs/07 calls the Add tab "an action, not a destination": it is a modal route, it never
 * renders as the current tab, and dismissing it returns you to whatever you were doing. The
 * modal chrome comes from `<ModalLayout>` in the route table; this screen supplies the form.
 *
 * The group is taken from `?gid=` when the flow was opened from a group (the FAB on
 * GroupDetail), and otherwise defaults to the most recently active group, so the common case is
 * amount → description → Save.
 *
 * 🔴 The expense id is minted **before** anything is previewed, because it is the split
 * engine's tie-break seed. Save writes under that same id, so the amounts the user approved are
 * the amounts that get stored — see `formState.ts`.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '@splitsutra/core/hooks';
import { createExpense, newExpenseId } from '@splitsutra/core/repositories';
import { DEFAULT_CURRENCY, type CurrencyCode } from '@splitsutra/core';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import { ModalHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { ExpenseForm } from './expense/ExpenseForm';
import { useComposerGroups, useComposerMembers } from './expense/composer';
import {
  deriveExpenseForm,
  initialFormState,
  syncParticipants,
  type ExpenseFormState,
} from './expense/formState';

/** A callable or a rules denial arrives as an `Error`; its message is written to be shown. */
function describeSaveError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length > 0 ? message : 'Could not save that expense. Try again.';
}

/**
 * Where to land after a successful save.
 *
 * 🔴 A friend expense goes into the friendship's **implicit** group (D2), and `GroupDetail` for
 * an implicit group is a dead end: `groupRepo` filters implicit groups out of the Groups tab, so
 * the screen you land on is one you can see exactly once and can never navigate back to. It also
 * presents a friendship as a group, which is the internal model leaking into the product.
 *
 * The friendship's own screen is the durable home for that expense, and now lists it.
 *
 * Falls back to the group screen if the other member cannot be identified — a 1:1 group with no
 * second member should not exist, and losing the redirect is a better failure than a broken URL.
 */
function destinationAfterSave(
  group: { readonly isImplicit: boolean; readonly memberIds: readonly string[] } | null,
  groupId: string,
  selfUid: string,
): string {
  if (group?.isImplicit !== true) return paths.GroupDetail({ gid: groupId });

  const friendUid = group.memberIds.find((memberId) => memberId !== selfUid);
  return friendUid === undefined
    ? paths.GroupDetail({ gid: groupId })
    : paths.FriendDetail({ uid: friendUid });
}

export function AddExpenseScreen() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const { user } = useAuth();
  const selfUid = user?.uid ?? '';

  const { groups, loading: groupsLoading, error: groupsError } = useComposerGroups();

  // `?gid=` wins, then whatever the form already holds, then the most recently active group.
  const [chosenGroupId, setChosenGroupId] = useState<string | null>(search.get('gid'));
  const groupId = chosenGroupId ?? groups[0]?.id ?? null;
  const group = groups.find((candidate) => candidate.id === groupId) ?? null;
  const currency: CurrencyCode = group?.currency ?? DEFAULT_CURRENCY;

  const { members, error: membersError } = useComposerMembers(groupId);

  const [state, setState] = useState<ExpenseFormState>(() =>
    initialFormState({ groupId, selfUid, memberUids: [], today: new Date() }),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The participant rows follow the group's membership, preserving anything already typed for
  // people who are in both groups.
  useEffect(() => {
    const memberUids = members.map((member) => member.uid);
    setState((previous) =>
      syncParticipants(
        {
          ...previous,
          groupId,
          singlePayerUid: previous.singlePayerUid === '' ? selfUid : previous.singlePayerUid,
        },
        memberUids,
      ),
    );
  }, [members, groupId, selfUid]);

  const expenseId = useMemo(() => (groupId === null ? '' : newExpenseId(groupId)), [groupId]);

  const derivation = useMemo(
    () => deriveExpenseForm(state, { currency, expenseId, today: new Date() }),
    [state, currency, expenseId],
  );

  async function save(): Promise<void> {
    const draft = derivation.draft;
    if (draft === null || selfUid === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      await createExpense(draft, selfUid, expenseId);
      void navigate(destinationAfterSave(group, draft.groupId, selfUid), { replace: true });
    } catch (cause: unknown) {
      setSaveError(describeSaveError(cause));
    } finally {
      setSaving(false);
    }
  }

  const header = <ModalHeader title="Add expense" dismissTo={paths.GroupList()} />;
  const error = groupsError ?? membersError;

  if (error !== null) {
    return (
      <Screen header={header} label="Add expense">
        <Stack gap="sm" aria-live="polite">
          <Text tone="danger">{`Could not open the expense form. ${error.message}`}</Text>
        </Stack>
      </Screen>
    );
  }

  if (groupsLoading) {
    return (
      <Screen header={header} label="Add expense">
        <Text tone="secondary">Loading…</Text>
      </Screen>
    );
  }

  if (groups.length === 0) {
    return (
      <Screen header={header} label="Add expense">
        <EmptyState
          glyph="👥"
          title="No group yet"
          body="Expenses live in a group, even a two-person one. Create a group or add a friend, then come back and split something."
          action={
            <>
              <Button to={paths.CreateGroup()}>Create a group</Button>
              <Button variant="secondary" to={paths.AddFriend()}>
                Add a friend
              </Button>
            </>
          }
        />
      </Screen>
    );
  }

  return (
    <ExpenseForm
      title="Add expense"
      saveLabel="Save"
      state={state}
      onChange={(next) => {
        if (next.groupId !== state.groupId) setChosenGroupId(next.groupId);
        setState(next);
      }}
      derivation={derivation}
      groups={groups}
      // Adding only. On the edit screen the stored category is somebody's decision, and a guess
      // does not get to revisit it.
      autoCategory
      members={members}
      currency={currency}
      selfUid={selfUid}
      selfName={user?.displayName ?? ''}
      saving={saving}
      saveError={saveError}
      onSave={() => {
        void save();
      }}
      dismissTo={paths.GroupList()}
    />
  );
}
