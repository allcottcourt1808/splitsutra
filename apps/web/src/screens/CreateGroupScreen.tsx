/**
 * `/groups/new` — name, type, currency (checklists/phase-05 §4).
 *
 * ## The currency picker is the reason this screen is not three lines
 *
 * 🔴 **A group's currency is immutable once written** (AC-C1.1, threat T10): changing it later
 * would reinterpret every stored `amountMinor` in the group, so Rules reject the update and this
 * is the only moment the choice can be made. That is why it is stated on the screen rather than
 * left as a default the user discovers afterwards.
 *
 * The list is filtered from `CURRENCIES` in core, never from `Intl.supportedValuesOf` — ICU data
 * varies between runtimes and Hermes ships a trimmed table, so a currency present on web and
 * absent on mobile would be a group nobody on a phone could open (`types/currency.ts`).
 *
 * The creator's `members/{uid}` document is written by `onGroupCreated`, not from here: a client
 * that could write a member document could write its own balance (Article III).
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import {
  COMMON_CURRENCIES,
  CURRENCIES,
  CURRENCY_CODES,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from '@splitsutra/core';
import { useAuth, useProfile } from '@splitsutra/core/hooks';
import { createGroup, type CreatableGroupType } from '@splitsutra/core/repositories';

import { Button } from '../components/Button';
import { Card, Screen, Row, Stack } from '../components/Layout';
import { Input } from '../components/Input';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { SegmentedControl } from '../components/SegmentedControl';
import { Text } from '../components/Text';
import { ModalHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/** `groupBaseSchema.shape.name` is 1–60; Rules check it again. */
const NAME_MAX = 60;

const TYPES = [
  { value: 'trip', label: 'Trip' },
  { value: 'home', label: 'Home' },
  { value: 'couple', label: 'Couple' },
  { value: 'other', label: 'Other' },
] as const satisfies readonly { value: CreatableGroupType; label: string }[];

/** An empty query shows the pinned eight; anything else matches on code *or* name. */
function matchingCurrencies(query: string): readonly CurrencyCode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return COMMON_CURRENCIES;

  return CURRENCY_CODES.filter((code) => {
    const meta = CURRENCIES[code];
    return code.toLowerCase().includes(needle) || meta.name.toLowerCase().includes(needle);
  });
}

function nameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Give the group a name — everyone in it sees this.';
  if (trimmed.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters or fewer.`;
  return undefined;
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'failed'; readonly message: string };

export function CreateGroupScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();

  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [type, setType] = useState<CreatableGroupType>('trip');
  const [draftCurrency, setDraftCurrency] = useState<CurrencyCode | null>(null);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const currency = draftCurrency ?? profile?.defaultCurrency ?? DEFAULT_CURRENCY;
  const results = useMemo(() => matchingCurrencies(query), [query]);
  const invalid = nameError(name);
  const canSave = user !== null && invalid === undefined && state.kind !== 'saving';

  async function save(): Promise<void> {
    if (!canSave || user === null) return;

    setState({ kind: 'saving' });
    try {
      const groupId = await createGroup(user.uid, { name: name.trim(), type, currency });
      // `replace` so the back gesture leaves the new group rather than reopening this form.
      await navigate(paths.GroupDetail({ gid: groupId }), { replace: true });
    } catch (cause: unknown) {
      setState({
        kind: 'failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Could not create that group. Check your connection and try again.',
      });
    }
  }

  return (
    <Screen
      header={
        <ModalHeader
          title="New group"
          dismissTo={paths.GroupList()}
          action={
            <Button
              variant="ghost"
              disabled={!canSave}
              loading={state.kind === 'saving'}
              onPress={() => {
                void save();
              }}
            >
              Create
            </Button>
          }
        />
      }
    >
      <Stack gap="lg">
        <Input
          label="Group name"
          value={name}
          onValueChange={(next) => {
            setName(next);
            setTouched(true);
            setState({ kind: 'idle' });
          }}
          placeholder="Goa Trip"
          autoFocus
          maxLength={NAME_MAX + 10}
          error={touched ? invalid : undefined}
        />

        <Stack gap="sm">
          <Text weight="semibold">Type</Text>
          <SegmentedControl label="Group type" options={TYPES} value={type} onValueChange={setType} />
        </Stack>

        <Stack gap="sm">
          <Row justify="between" align="baseline">
            <Text weight="semibold">Currency</Text>
            <Text variant="caption" tone="secondary">
              {currency} · {CURRENCIES[currency].symbol}
            </Text>
          </Row>

          <Card>
            <Text variant="caption" tone="secondary">
              Pick carefully: a group&apos;s currency is fixed when it is created. Every expense in
              it is recorded in {currency}, and nothing is ever converted.
            </Text>
          </Card>

          <Input
            label="Find a currency"
            value={query}
            onValueChange={setQuery}
            type="search"
            inputMode="search"
            placeholder="USD, rupee, yen…"
            helper={
              query.trim().length === 0
                ? 'Showing the most common. Type to search them all.'
                : `${results.length} ${results.length === 1 ? 'match' : 'matches'}.`
            }
          />

          <Card flush>
            <List
              data={results}
              aria-label="Currencies"
              keyExtractor={(code) => code}
              empty={
                <Stack padding="md">
                  <Text tone="secondary">
                    No currency matches “{query.trim()}”. Try the three-letter code.
                  </Text>
                </Stack>
              }
              renderItem={(code) => (
                <ListRow
                  title={`${code} — ${CURRENCIES[code].name}`}
                  subtitle={code === currency ? 'Selected' : undefined}
                  chevron={false}
                  trailing={
                    <Text aria-hidden tone={code === currency ? 'primary' : 'secondary'}>
                      {code === currency ? '✓' : CURRENCIES[code].symbol}
                    </Text>
                  }
                  label={
                    code === currency
                      ? `${CURRENCIES[code].name}, selected`
                      : `Use ${CURRENCIES[code].name}`
                  }
                  onPress={() => {
                    setDraftCurrency(code);
                    setState({ kind: 'idle' });
                  }}
                />
              )}
            />
          </Card>
        </Stack>

        {state.kind === 'failed' && (
          <Stack aria-live="polite">
            <Text tone="danger">{state.message}</Text>
          </Stack>
        )}
      </Stack>
    </Screen>
  );
}
