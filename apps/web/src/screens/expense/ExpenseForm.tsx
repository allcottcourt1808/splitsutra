/**
 * The Add/Edit Expense form — docs/07 §AddExpense, "the screen the product lives or dies on".
 *
 * Optimised for the three-tap path: the amount is autofocused with a numeric keypad, the payer
 * defaults to you, the split defaults to equally across everyone, and the date defaults to
 * today. Everything else is one tap away and nothing else is required.
 *
 * All state lives with the caller (`AddExpenseScreen` / `EditExpenseScreen`) and every derived
 * value comes from `deriveExpenseForm`, so this file only renders. In particular **it does no
 * arithmetic**: the per-person amounts beside each row are the split engine's own output, which
 * is what makes the promise "the preview equals what gets stored" true rather than aspirational.
 */

import type { ReactNode } from 'react';

import {
  EXPENSE_CATEGORIES,
  type CurrencyCode,
  type ExpenseCategory,
  type Group,
  type GroupMember,
  type MinorUnits,
  type SplitMethod,
} from '@splitsutra/core';

import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Input } from '../../components/Input';
import { Card, Row, Screen, Stack } from '../../components/Layout';
import { Money, currencySymbol } from '../../components/Money';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { ModalHeader } from '../../navigation/ScreenHeader';
import {
  toDateInput,
  type ExpenseFormState,
  type FormDerivation,
  type ParticipantState,
} from './formState';

/** One decorative glyph per category (AC-D1.6). The label always carries the meaning. */
const CATEGORY_GLYPH: Readonly<Record<ExpenseCategory, string>> = {
  general: '🧾',
  food: '🍽',
  groceries: '🛒',
  transport: '🚕',
  fuel: '⛽',
  travel: '✈️',
  accommodation: '🏨',
  rent: '🔑',
  utilities: '💡',
  household: '🧹',
  entertainment: '🎬',
  medical: '🩺',
  insurance: '🛡',
  education: '🎓',
};

const SPLIT_METHODS = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Exactly' },
  { value: 'percent', label: 'Percent' },
  { value: 'shares', label: 'Shares' },
] as const satisfies readonly { value: SplitMethod; label: string }[];

const PAYER_MODES = [
  { value: 'single', label: 'One person' },
  { value: 'multiple', label: 'Several people' },
] as const;

/** Title case for a category key, so the list needs no second table of labels. */
function categoryLabel(category: ExpenseCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export interface ExpenseFormProps {
  readonly title: string;
  readonly saveLabel: string;
  readonly state: ExpenseFormState;
  readonly onChange: (next: ExpenseFormState) => void;
  readonly derivation: FormDerivation;
  /** Choices for the group picker. Empty or `locked` hides it. */
  readonly groups: readonly Group[];
  /** Editing cannot move an expense between groups — `groupId` and `currency` are immutable. */
  readonly locked?: boolean | undefined;
  readonly members: readonly GroupMember[];
  readonly currency: CurrencyCode;
  readonly selfUid: string;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onSave: () => void;
  /** Where dismissing lands when the modal was deep-linked with no history behind it. */
  readonly dismissTo: string;
  /** Rendered at the bottom — the Delete action on the edit screen. */
  readonly footerActions?: ReactNode | undefined;
}

export function ExpenseForm({
  title,
  saveLabel,
  state,
  onChange,
  derivation,
  groups,
  locked = false,
  members,
  currency,
  selfUid,
  saving,
  saveError,
  onSave,
  dismissTo,
  footerActions,
}: ExpenseFormProps) {
  const patch = (next: Partial<ExpenseFormState>): void => {
    onChange({ ...state, ...next });
  };

  const patchParticipant = (uid: string, next: Partial<ParticipantState>): void => {
    onChange({
      ...state,
      participants: state.participants.map((participant) =>
        participant.uid === uid ? { ...participant, ...next } : participant,
      ),
    });
  };

  const nameOf = (uid: string): string => {
    if (uid === selfUid) return 'You';
    return members.find((member) => member.uid === uid)?.displayName ?? 'Former member';
  };

  const photoOf = (uid: string): string | null =>
    members.find((member) => member.uid === uid)?.photoURL ?? null;

  const allocationFor = (uid: string): MinorUnits | null =>
    derivation.allocations?.find((allocation) => allocation.uid === uid)?.amountMinor ?? null;

  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  const header = (
    <ModalHeader
      title={title}
      dismissTo={dismissTo}
      action={
        <Button onPress={onSave} disabled={derivation.draft === null} loading={saving}>
          {saveLabel}
        </Button>
      }
    />
  );

  return (
    <Screen header={header} label={title}>
      <Stack gap="lg">
        {/* ── Group ───────────────────────────────────────────────────────────────────── */}
        {!locked && groups.length > 0 && (
          <Stack gap="sm">
            <Text variant="caption" tone="secondary" weight="semibold">
              With you and
            </Text>
            <Row gap="sm" wrap>
              {groups.map((group) => (
                <Chip
                  key={group.id}
                  label={group.name}
                  selected={group.id === state.groupId}
                  onPress={() => {
                    patch({ groupId: group.id });
                  }}
                />
              ))}
            </Row>
          </Stack>
        )}

        {/* ── Description and amount ──────────────────────────────────────────────────── */}
        <Input
          label="Amount"
          value={state.amountInput}
          onValueChange={(value) => {
            patch({ amountInput: value });
          }}
          inputMode="decimal"
          autoFocus
          placeholder="0"
          leading={<Text aria-hidden>{currencySymbol(currency)}</Text>}
          error={derivation.amountError ?? undefined}
          helper={`In ${currency}. Use a full stop for decimals.`}
        />

        <Input
          label="Description"
          value={state.description}
          onValueChange={(value) => {
            patch({ description: value });
          }}
          maxLength={100}
          placeholder="Dinner at Olive"
          error={derivation.descriptionError ?? undefined}
        />

        {/* ── Date ────────────────────────────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Input
            label="Date"
            value={state.dateInput}
            onValueChange={(value) => {
              patch({ dateInput: value });
            }}
            inputMode="numeric"
            placeholder="2026-08-29"
            helper="YYYY-MM-DD"
            error={derivation.dateError ?? undefined}
          />
          <Row gap="sm" wrap>
            <Chip
              label="Today"
              selected={state.dateInput === toDateInput(today)}
              onPress={() => {
                patch({ dateInput: toDateInput(today) });
              }}
            />
            <Chip
              label="Yesterday"
              selected={state.dateInput === toDateInput(yesterday)}
              onPress={() => {
                patch({ dateInput: toDateInput(yesterday) });
              }}
            />
          </Row>
        </Stack>

        {/* ── Category ────────────────────────────────────────────────────────────────── */}
        <Stack gap="sm">
          <Text variant="caption" tone="secondary" weight="semibold">
            Category
          </Text>
          <Row gap="sm" wrap>
            {EXPENSE_CATEGORIES.map((category) => (
              <Chip
                key={category}
                label={categoryLabel(category)}
                glyph={CATEGORY_GLYPH[category]}
                selected={category === state.category}
                onPress={() => {
                  patch({ category });
                }}
              />
            ))}
          </Row>
        </Stack>

        {/* ── Paid by ─────────────────────────────────────────────────────────────────── */}
        <Card>
          <Stack gap="md">
            <Text weight="semibold">Paid by</Text>
            <SegmentedControl
              label="Who paid"
              options={PAYER_MODES}
              value={state.payerMode}
              onValueChange={(mode) => {
                patch({ payerMode: mode });
              }}
            />

            {state.payerMode === 'single' ? (
              <Row gap="sm" wrap>
                {members.map((member) => (
                  <Chip
                    key={member.uid}
                    label={nameOf(member.uid)}
                    selected={member.uid === state.singlePayerUid}
                    onPress={() => {
                      patch({ singlePayerUid: member.uid });
                    }}
                  />
                ))}
              </Row>
            ) : (
              <Stack gap="sm">
                {members.map((member) => (
                  <Input
                    key={member.uid}
                    label={nameOf(member.uid)}
                    value={state.payerInputs[member.uid] ?? ''}
                    onValueChange={(value) => {
                      patch({ payerInputs: { ...state.payerInputs, [member.uid]: value } });
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    leading={<Text aria-hidden>{currencySymbol(currency)}</Text>}
                  />
                ))}
                {derivation.payerRemainingMinor !== null &&
                  derivation.payerRemainingMinor !== 0 && (
                    <Stack aria-live="polite">
                      <Money
                        minorUnits={Math.abs(derivation.payerRemainingMinor) as MinorUnits}
                        currency={currency}
                        tone="negative"
                        label={
                          derivation.payerRemainingMinor > 0
                            ? 'still unaccounted for:'
                            : 'paid over the total:'
                        }
                      />
                    </Stack>
                  )}
              </Stack>
            )}

            {derivation.payerError !== null && (
              <Text variant="caption" tone="danger">
                {derivation.payerError}
              </Text>
            )}
          </Stack>
        </Card>

        {/* ── Split ───────────────────────────────────────────────────────────────────── */}
        <Card>
          <Stack gap="md">
            <Text weight="semibold">Split</Text>
            <SegmentedControl
              label="Split method"
              options={SPLIT_METHODS}
              value={state.splitMethod}
              onValueChange={(method) => {
                // AC-D2.5 — the participants and the total are untouched; only the method moves.
                patch({ splitMethod: method });
              }}
            />

            <Stack gap="sm">
              {state.participants.map((participant) => (
                <SplitRow
                  key={participant.uid}
                  participant={participant}
                  method={state.splitMethod}
                  name={nameOf(participant.uid)}
                  photoURL={photoOf(participant.uid)}
                  currency={currency}
                  allocation={allocationFor(participant.uid)}
                  onChange={(next) => {
                    patchParticipant(participant.uid, next);
                  }}
                />
              ))}
            </Stack>

            {/* The footer is the primary feedback mechanism (docs/07). Save is blocked exactly
                when it reads non-zero, and colour is never the only signal (NFR-5). */}
            <Row gap="xs" align="center" aria-live="polite">
              {derivation.footer.amounts.map((amount, index) => (
                <Row key={`${String(index)}-${String(amount)}`} gap="xs" align="center">
                  {index > 0 && (
                    <Text tone="secondary" aria-hidden>
                      –
                    </Text>
                  )}
                  <Money
                    minorUnits={amount}
                    currency={currency}
                    tone={derivation.footer.danger ? 'negative' : 'plain'}
                  />
                </Row>
              ))}
              <Text
                variant="caption"
                tone={derivation.footer.danger ? 'danger' : 'secondary'}
                weight="medium"
              >
                {derivation.footer.text}
              </Text>
            </Row>

            {derivation.splitError !== null && (
              <Text variant="caption" tone="danger">
                {derivation.splitError}
              </Text>
            )}
          </Stack>
        </Card>

        {saveError !== null && (
          <Stack aria-live="polite">
            <Text tone="danger">{saveError}</Text>
          </Stack>
        )}

        {footerActions}
      </Stack>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* One participant row                                                        */
/* -------------------------------------------------------------------------- */

interface SplitRowProps {
  readonly participant: ParticipantState;
  readonly method: SplitMethod;
  readonly name: string;
  readonly photoURL: string | null;
  readonly currency: CurrencyCode;
  readonly allocation: MinorUnits | null;
  readonly onChange: (next: Partial<ParticipantState>) => void;
}

/**
 * The per-member control, plus the amount that member will actually owe.
 *
 * A participant may be included with a zero share and stays listed (AC-D2.6), so inclusion and
 * value are two separate controls rather than one.
 */
function SplitRow({
  participant,
  method,
  name,
  photoURL,
  currency,
  allocation,
  onChange,
}: SplitRowProps) {
  const included = participant.included;

  return (
    <Stack gap="xs">
      <Row gap="sm" align="center">
        <Chip
          label={included ? '✓' : '○'}
          selected={included}
          onPress={() => {
            onChange({ included: !included });
          }}
        />
        <Avatar name={name} photoURL={photoURL} size="avatarSm" />
        <Text truncate>{name}</Text>
        {included && allocation !== null && (
          <Row justify="end" flex="1">
            <Money minorUnits={allocation} currency={currency} tone="plain" />
          </Row>
        )}
      </Row>

      {included && method === 'exact' && (
        <Input
          label={`${name} owes`}
          value={participant.exactInput}
          onValueChange={(value) => {
            onChange({ exactInput: value });
          }}
          inputMode="decimal"
          placeholder="0"
        />
      )}

      {included && method === 'percent' && (
        <Input
          label={`${name}'s share`}
          value={participant.percentInput}
          onValueChange={(value) => {
            onChange({ percentInput: value });
          }}
          inputMode="decimal"
          placeholder="0"
          trailing={<Text aria-hidden>%</Text>}
        />
      )}

      {included && method === 'shares' && (
        <Row gap="sm" align="center">
          <Button
            variant="secondary"
            label={`One fewer share for ${name}`}
            onPress={() => {
              onChange({ shares: Math.max(0, participant.shares - 1) });
            }}
          >
            −
          </Button>
          <Text>{`${String(participant.shares)} ${participant.shares === 1 ? 'share' : 'shares'}`}</Text>
          <Button
            variant="secondary"
            label={`One more share for ${name}`}
            onPress={() => {
              onChange({ shares: participant.shares + 1 });
            }}
          >
            +
          </Button>
        </Row>
      )}
    </Stack>
  );
}
