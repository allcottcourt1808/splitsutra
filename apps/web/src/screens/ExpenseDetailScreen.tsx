/**
 * `/expense/:gid/:eid` — the full breakdown, and the discussion thread.
 *
 * ## This screen carries ADR-11
 *
 * Only the person who created an expense, or a group admin, may edit it. Everyone else
 * discusses it. If **Discuss** is hard to find, restricted editing reads as "the app is broken"
 * rather than "ask them about it" (docs/07), so the permission model is stated in words at the
 * moment it applies — never a dead Edit button, and never silence.
 *
 * Article VIII: every read here is a hook, every write a repository call. No Firestore.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAuth, useExpense, useExpenseComments, useProfile } from '@splitsutra/core/hooks';
import { addExpenseComment, softDeleteExpense } from '@splitsutra/core/repositories';
import { formatRelativeTime, type Expense, type GroupMember } from '@splitsutra/core';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { Input } from '../components/Input';
import { Card, Divider, Row, Screen, Stack } from '../components/Layout';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Money } from '../components/Money';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';
import { formatPercentInput } from './expense/amount';
import { useComposerMembers } from './expense/composer';

/** Title case for a category key — the stored value is the lowercase enum member. */
function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** AC-D3.3 — the delete is held for five seconds so it can be taken back before it commits. */
const UNDO_WINDOW_MS = 5_000;

function nameOf(members: readonly GroupMember[], uid: string, selfUid: string): string {
  if (uid === selfUid) return 'You';
  return members.find((member) => member.uid === uid)?.displayName ?? 'A former member';
}

function photoOf(members: readonly GroupMember[], uid: string): string | null {
  return members.find((member) => member.uid === uid)?.photoURL ?? null;
}

/** ADR-11 — the creator, or an admin (which covers a creator who has since left the group). */
function canEdit(expense: Expense, members: readonly GroupMember[], selfUid: string): boolean {
  if (selfUid === '') return false;
  if (expense.createdBy === selfUid) return true;
  return members.some((member) => member.uid === selfUid && member.role === 'admin');
}

export function ExpenseDetailScreen() {
  const navigate = useNavigate();
  const { gid = '', eid = '' } = useParams();
  const { user } = useAuth();
  const { profile } = useProfile();
  const selfUid = user?.uid ?? '';

  const { expense, loading, error } = useExpense(gid, eid);
  const { members } = useComposerMembers(gid);
  const { comments, loading: commentsLoading } = useExpenseComments(gid, eid);

  const [draftComment, setDraftComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Non-null while a delete is pending. Nothing has been written yet. */
  const [deletingSince, setDeletingSince] = useState<number | null>(null);

  // The write is deliberately deferred, not written-then-reversed: an undo that has to reach
  // the server to work is an undo that fails offline.
  useEffect(() => {
    if (deletingSince === null) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          await softDeleteExpense(gid, eid, selfUid);
          void navigate(paths.GroupDetail({ gid }), { replace: true });
        } catch (cause: unknown) {
          setActionError(cause instanceof Error ? cause.message : 'Could not delete that.');
        } finally {
          setDeletingSince(null);
        }
      })();
    }, UNDO_WINDOW_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [deletingSince, gid, eid, selfUid, navigate]);

  const header = (
    <ScreenHeader
      title={expense?.description ?? 'Expense'}
      backTo={gid === '' ? paths.GroupList() : paths.GroupDetail({ gid })}
    />
  );

  if (loading) {
    return (
      <Screen header={header}>
        <Text tone="secondary">Loading…</Text>
      </Screen>
    );
  }

  if (error !== null) {
    return (
      <Screen header={header}>
        <Stack gap="sm" aria-live="polite">
          <Text tone="danger">{`Could not load this expense. ${error.message}`}</Text>
        </Stack>
      </Screen>
    );
  }

  if (expense === null) {
    return (
      <Screen header={header}>
        <EmptyState
          glyph="🔍"
          title="Expense not found"
          body="It may have been removed, or the link may be wrong."
          action={<Button to={paths.GroupList()}>Back to groups</Button>}
        />
      </Screen>
    );
  }

  const editable = canEdit(expense, members, selfUid);
  const creatorName = nameOf(members, expense.createdBy, selfUid);

  async function post(): Promise<void> {
    const text = draftComment.trim();
    if (text === '' || posting || selfUid === '') return;

    setPosting(true);
    setActionError(null);
    try {
      await addExpenseComment(
        gid,
        eid,
        {
          uid: selfUid,
          displayName: profile?.displayName ?? nameOf(members, selfUid, ''),
          photoURL: profile?.photoURL ?? null,
        },
        text,
      );
      setDraftComment('');
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : 'Could not post that comment.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <Screen header={header} label={expense.description}>
      <Stack gap="lg">
        {expense.deletedAt !== null && (
          <Card>
            <Text tone="danger" weight="semibold">
              This expense was deleted. It stays here for the record and no longer counts towards
              anyone&rsquo;s balance.
            </Text>
          </Card>
        )}

        {/* ── The headline ────────────────────────────────────────────────────────────── */}
        <Card>
          <Stack gap="sm">
            <Money
              minorUnits={expense.amountMinor}
              currency={expense.currency}
              tone="plain"
              size="large"
            />
            <Text variant="title">{expense.description}</Text>
            <Row gap="sm" wrap align="center">
              <Chip label={categoryLabel(expense.category)} />
              <Text variant="caption" tone="secondary">
                {formatRelativeTime(expense.date.toMillis())}
              </Text>
            </Row>
          </Stack>
        </Card>

        {/* ── Who paid ────────────────────────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Paid by
          </Text>
          <List
            data={expense.paidBy}
            aria-label="Who paid"
            keyExtractor={(payer) => payer.uid}
            renderItem={(payer) => (
              <ListRow
                title={nameOf(members, payer.uid, selfUid)}
                leading={
                  <Avatar
                    name={nameOf(members, payer.uid, selfUid)}
                    photoURL={photoOf(members, payer.uid)}
                  />
                }
                trailing={
                  <Money
                    minorUnits={payer.amountMinor}
                    currency={expense.currency}
                    tone="plain"
                    label="paid"
                  />
                }
              />
            )}
          />
        </Stack>

        {/* ── Each person's share ─────────────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            {`Split ${expense.splitMethod === 'equal' ? 'equally' : `by ${expense.splitMethod}`}`}
          </Text>
          <List
            data={expense.splits}
            aria-label="Each person's share"
            keyExtractor={(split) => split.uid}
            renderItem={(split) => (
              <ListRow
                title={nameOf(members, split.uid, selfUid)}
                subtitle={
                  expense.splitMethod === 'percent' && split.rawValue !== null
                    ? `${formatPercentInput(split.rawValue)}%`
                    : expense.splitMethod === 'shares' && split.rawValue !== null
                      ? `${String(split.rawValue)} ${split.rawValue === 1 ? 'share' : 'shares'}`
                      : undefined
                }
                leading={
                  <Avatar
                    name={nameOf(members, split.uid, selfUid)}
                    photoURL={photoOf(members, split.uid)}
                  />
                }
                trailing={
                  <Money
                    minorUnits={split.amountMinor}
                    currency={expense.currency}
                    tone="plain"
                    label="owes"
                  />
                }
              />
            )}
          />
        </Stack>

        {/* ── Provenance ──────────────────────────────────────────────────────────────── */}
        <Card>
          <Stack gap="xs">
            <Text variant="caption" tone="secondary">
              {`Added by ${creatorName} ${formatRelativeTime(expense.createdAt.toMillis())}`}
            </Text>
            {expense.updatedBy !== null && (
              <Text variant="caption" tone="secondary">
                {`Edited by ${nameOf(members, expense.updatedBy, selfUid)} ${formatRelativeTime(
                  expense.updatedAt.toMillis(),
                )}`}
              </Text>
            )}
          </Stack>
        </Card>

        {/* ── ADR-11: the primary action depends on who you are ───────────────────────── */}
        {expense.deletedAt === null &&
          (editable ? (
            <Stack gap="sm">
              <Button to={paths.EditExpense({ gid, eid })} fullWidth>
                Edit expense
              </Button>
              {deletingSince === null ? (
                <Button
                  variant="danger"
                  fullWidth
                  onPress={() => {
                    setDeletingSince(Date.now());
                  }}
                >
                  Delete expense
                </Button>
              ) : (
                <Card>
                  <Row gap="sm" align="center" aria-live="polite">
                    <Text>Deleting this expense…</Text>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setDeletingSince(null);
                      }}
                    >
                      Undo
                    </Button>
                  </Row>
                </Card>
              )}
            </Stack>
          ) : (
            <Card>
              <Stack gap="xs">
                <Text weight="semibold">Something look wrong?</Text>
                <Text variant="caption" tone="secondary">
                  {`Start a discussion below — only ${creatorName} or a group admin can edit this expense.`}
                </Text>
              </Stack>
            </Card>
          ))}

        {actionError !== null && (
          <Stack aria-live="polite">
            <Text tone="danger">{actionError}</Text>
          </Stack>
        )}

        <Divider />

        {/* ── Discussion ──────────────────────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Discussion
          </Text>

          {commentsLoading ? (
            <Text tone="secondary">Loading the thread…</Text>
          ) : (
            <List
              data={comments}
              aria-label="Discussion"
              keyExtractor={(comment) => comment.id}
              empty={
                <Card>
                  <Text variant="caption" tone="secondary">
                    No comments yet.
                  </Text>
                </Card>
              }
              renderItem={(comment) => (
                <ListRow
                  title={comment.uid === selfUid ? 'You' : comment.displayName}
                  subtitle={comment.deletedAt === null ? comment.text : 'This comment was deleted.'}
                  leading={<Avatar name={comment.displayName} photoURL={comment.photoURL} />}
                  trailing={
                    <Text variant="caption" tone="secondary">
                      {formatRelativeTime(comment.createdAt.toMillis())}
                    </Text>
                  }
                  muted={comment.deletedAt !== null}
                />
              )}
            />
          )}

          <Input
            label="Add a comment"
            value={draftComment}
            onValueChange={setDraftComment}
            maxLength={500}
            placeholder="Wasn’t this ₹2,000?"
            helper="Comments cannot be edited once posted."
          />
          <Button
            fullWidth
            variant="secondary"
            disabled={draftComment.trim() === ''}
            loading={posting}
            onPress={() => {
              void post();
            }}
          >
            Post comment
          </Button>
        </Stack>
      </Stack>
    </Screen>
  );
}
