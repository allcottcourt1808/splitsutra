/**
 * `/expense/:gid/:eid/edit` — the same form as Add, seeded from a stored expense.
 *
 * Three things make this screen different from `AddExpenseScreen`, and all three are
 * load-bearing:
 *
 * 🔴 **The tie-break seed is the expense's own id.** `deriveExpenseForm` previews with `eid`
 * and `updateExpense` re-derives with `eid`, so re-saving an unchanged equal split hands the
 * leftover minor unit to the same person it did before (docs/04 §2.1). Minting a fresh id here
 * would silently move a cent between two people on every save.
 *
 * 🔴 **The form is seeded from `rawValue`, not from the resolved amounts.** A percentage split
 * reopens showing the percentages that were typed — `formStateFromExpense` does that — and the
 * participant rows are the union of the old split and the group's current members (AC-D3.2), so
 * an edit can add someone who was not in the original.
 *
 * 🔴 **ADR-11 is refused here, not just hidden.** Only the creator or a group admin may update
 * an expense. A form that renders and then dies on a rules denial reads as a broken app, so
 * this screen states the rule instead of showing fields nobody can save.
 *
 * Article V: the Delete action is a soft delete. There is no hard delete of an expense.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAuth, useExpense } from '@splitsutra/core/hooks';
import { softDeleteExpense, updateExpense } from '@splitsutra/core/repositories';
import type { Expense, GroupMember } from '@splitsutra/core';

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import { ModalHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { ExpenseForm } from './expense/ExpenseForm';
import { useComposerMembers } from './expense/composer';
import {
  deriveExpenseForm,
  formStateFromExpense,
  type ExpenseFormState,
} from './expense/formState';

/**
 * ADR-11 — the creator, or an admin, which also covers a creator who has left the group.
 *
 * Mirrors the same predicate on `ExpenseDetailScreen`; it belongs in core beside the rules it
 * restates, and moving it is a separate change from writing this screen.
 */
function canEdit(expense: Expense, members: readonly GroupMember[], selfUid: string): boolean {
  if (selfUid === '') return false;
  if (expense.createdBy === selfUid) return true;
  return members.some((member) => member.uid === selfUid && member.role === 'admin');
}

function describeError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length > 0 ? message : 'Could not save that expense. Try again.';
}

export function EditExpenseScreen() {
  const navigate = useNavigate();
  const { gid = '', eid = '' } = useParams();
  const { user } = useAuth();
  const selfUid = user?.uid ?? '';

  const { expense, loading, error } = useExpense(gid, eid);
  const { members, loading: membersLoading, error: membersError } = useComposerMembers(gid);
  const memberUids = useMemo(() => members.map((member) => member.uid), [members]);

  const [state, setState] = useState<ExpenseFormState | null>(null);
  /** Stops the seeding effect the moment the user types, so a live snapshot cannot overwrite. */
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (expense === null || touched) return;
    setState(formStateFromExpense(expense, memberUids));
  }, [expense, memberUids, touched]);

  const currency = expense?.currency ?? null;
  const derivation = useMemo(
    () =>
      state === null || currency === null
        ? null
        : deriveExpenseForm(state, { currency, expenseId: eid, today: new Date() }),
    [state, currency, eid],
  );

  const backTo = gid === '' ? paths.GroupList() : paths.ExpenseDetail({ gid, eid });
  const header = <ModalHeader title="Edit expense" dismissTo={backTo} />;

  async function save(): Promise<void> {
    const draft = derivation?.draft ?? null;
    if (draft === null || selfUid === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      await updateExpense(gid, eid, draft, selfUid);
      void navigate(paths.ExpenseDetail({ gid, eid }), { replace: true });
    } catch (cause: unknown) {
      setSaveError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (selfUid === '' || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      await softDeleteExpense(gid, eid, selfUid);
      void navigate(paths.GroupDetail({ gid }), { replace: true });
    } catch (cause: unknown) {
      setSaveError(describeError(cause));
    } finally {
      setSaving(false);
    }
  }

  if (error !== null || membersError !== null) {
    const failure = error ?? membersError;
    return (
      <Screen header={header} label="Edit expense">
        <Stack gap="sm" aria-live="polite">
          <Text tone="danger">{`Could not open this expense. ${failure?.message ?? ''}`}</Text>
          <Button variant="secondary" to={backTo}>
            Back to the expense
          </Button>
        </Stack>
      </Screen>
    );
  }

  if (loading || membersLoading) {
    return (
      <Screen header={header} label="Edit expense">
        <Text tone="secondary">Loading…</Text>
      </Screen>
    );
  }

  if (expense === null) {
    return (
      <Screen header={header} label="Edit expense">
        <EmptyState
          glyph="🔍"
          title="Expense not found"
          body="It may have been removed, or the link may be wrong."
          action={<Button to={paths.GroupList()}>Back to groups</Button>}
        />
      </Screen>
    );
  }

  if (expense.deletedAt !== null) {
    return (
      <Screen header={header} label="Edit expense">
        <EmptyState
          glyph="🗑"
          title="This expense was deleted"
          body="It stays in the group's history for the record and no longer counts towards anyone's balance, so there is nothing here to edit."
          action={<Button to={backTo}>Back to the expense</Button>}
        />
      </Screen>
    );
  }

  if (!canEdit(expense, members, selfUid)) {
    const creator =
      members.find((member) => member.uid === expense.createdBy)?.displayName ?? 'whoever added it';
    return (
      <Screen header={header} label="Edit expense">
        <EmptyState
          glyph="💬"
          title="Only the person who added this can edit it"
          body={`${creator} or a group admin can change this expense. If something looks wrong, say so on the expense and they can fix it.`}
          action={<Button to={backTo}>Discuss it instead</Button>}
        />
      </Screen>
    );
  }

  if (state === null || derivation === null) {
    return (
      <Screen header={header} label="Edit expense">
        <Text tone="secondary">Loading…</Text>
      </Screen>
    );
  }

  return (
    <ExpenseForm
      title="Edit expense"
      saveLabel="Save changes"
      state={state}
      onChange={(next) => {
        setTouched(true);
        setState(next);
      }}
      derivation={derivation}
      groups={[]}
      locked
      members={members}
      currency={expense.currency}
      selfUid={selfUid}
      saving={saving}
      saveError={saveError}
      onSave={() => {
        void save();
      }}
      dismissTo={backTo}
      footerActions={
        <Card>
          {confirmingDelete ? (
            <Stack gap="sm" aria-live="polite">
              <Text>
                Delete this expense? It stays in the group&rsquo;s history for the record and stops
                counting towards anyone&rsquo;s balance.
              </Text>
              <Row gap="sm" wrap>
                <Button
                  variant="danger"
                  loading={saving}
                  onPress={() => {
                    void remove();
                  }}
                >
                  Delete expense
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setConfirmingDelete(false);
                  }}
                >
                  Keep it
                </Button>
              </Row>
            </Stack>
          ) : (
            <Button
              variant="danger"
              fullWidth
              onPress={() => {
                setConfirmingDelete(true);
              }}
            >
              Delete expense
            </Button>
          )}
        </Card>
      }
    />
  );
}
