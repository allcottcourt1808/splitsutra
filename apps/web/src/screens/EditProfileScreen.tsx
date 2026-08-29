/**
 * `/account/profile` — display name and default currency (phase-03 §5; AC-A2.1, AC-A2.2).
 *
 * ## Why the currency list is not a `<select>`
 *
 * AC-A2.2 asks for the **full ISO 4217 set**, searchable, with the common currencies pinned to
 * the top. That is 157 entries: a native picker on a phone is a scroll wheel with no search,
 * and finding `SGD` in it takes longer than typing it. So the control is a filter field over a
 * list, which is also the one shape that ports — `FlatList` with a `TextInput` above it.
 *
 * 🔴 The list is built from `CURRENCIES` in core, **never** from `Intl.supportedValuesOf`.
 * `types/currency.ts` explains why in full: ICU data varies between runtimes and Hermes on
 * React Native is frequently built with a trimmed one, so a currency present on web and absent
 * on mobile would be a group nobody on a phone could open. The table is the source of truth for
 * what exists; `Intl` is display only.
 *
 * ## Saving
 *
 * One write, through `updateUserProfile`, which parses the name with the same schema the read
 * boundary uses. Article IV: that parse is UX — it turns an over-long name into a field-level
 * message instead of a flat permission-denied — and Security Rules re-check it regardless.
 *
 * The screen stays on itself after a successful save rather than popping back, because the
 * currency list is the kind of thing people change and immediately reconsider. The Save button
 * disables itself when nothing has changed, which is the honest way to say "there is nothing to
 * do here" without a toast.
 */

import { useMemo, useState } from 'react';

import { COMMON_CURRENCIES, CURRENCIES, CURRENCY_CODES, type CurrencyCode } from '@splitsutra/core';
import { useAuth, useProfile } from '@splitsutra/core/hooks';
import { updateUserProfile } from '@splitsutra/core/repositories';

import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { Input } from '../components/Input';
import { List } from '../components/List';
import { ListRow } from '../components/ListRow';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/** AC-A2.1. Enforced again by `displayNameSchema` inside the repository, and by Rules. */
const NAME_MAX = 50;

/**
 * The currencies to show for `query`.
 *
 * An empty query shows the pinned eight — a list of 157 with no filter is a wall, and the
 * overwhelmingly likely answer is one of these. Anything else matches on code *or* name, so
 * both "SGD" and "singapore" find the same row.
 */
function matchingCurrencies(query: string): readonly CurrencyCode[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return COMMON_CURRENCIES;

  return CURRENCY_CODES.filter((code) => {
    const meta = CURRENCIES[code];
    return code.toLowerCase().includes(needle) || meta.name.toLowerCase().includes(needle);
  });
}

/** AC-A2.1: 1–50 characters after trimming. The message says what to do, not what is wrong. */
function nameError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Your name cannot be blank — friends see it on every expense.';
  if (trimmed.length > NAME_MAX) return `Keep it to ${NAME_MAX} characters or fewer.`;
  return undefined;
}

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly message: string };

export function EditProfileScreen() {
  const { user } = useAuth();
  const { profile, loading } = useProfile();

  /**
   * The draft, seeded from the profile the first time it arrives.
   *
   * `null` means "not seeded yet" and is distinguishable from an empty name the user typed —
   * which is why it is not just `useState('')`. Seeding inside render rather than in an effect
   * avoids the frame where the fields are blank under a profile that has already loaded.
   */
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftCurrency, setDraftCurrency] = useState<CurrencyCode | null>(null);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  const name = draftName ?? profile?.displayName ?? '';
  const currency = draftCurrency ?? profile?.defaultCurrency ?? null;

  const results = useMemo(() => matchingCurrencies(query), [query]);
  const invalid = nameError(name);

  const changed =
    profile !== null &&
    (name.trim() !== profile.displayName ||
      (currency !== null && currency !== profile.defaultCurrency));

  const canSave =
    profile !== null &&
    user !== null &&
    changed &&
    invalid === undefined &&
    state.kind !== 'saving';

  async function save(): Promise<void> {
    if (!canSave || user === null || profile === null) return;

    setState({ kind: 'saving' });
    try {
      await updateUserProfile(user.uid, {
        // Only the fields that actually differ. `updateUserProfile` no-ops on an empty patch,
        // and sending an unchanged `displayName` would still cost a write and an `updatedAt`.
        ...(name.trim() === profile.displayName ? {} : { displayName: name.trim() }),
        ...(currency === null || currency === profile.defaultCurrency
          ? {}
          : { defaultCurrency: currency }),
      });
      setState({ kind: 'saved' });
    } catch (cause: unknown) {
      setState({
        kind: 'failed',
        message:
          cause instanceof Error
            ? cause.message
            : 'Could not save your profile. Check your connection and try again.',
      });
    }
  }

  return (
    <Screen
      header={<ScreenHeader title="Edit profile" backTo={paths.Account()} />}
      footer={
        <Stack padding="md" gap="sm" aria-live="polite">
          {state.kind === 'failed' && (
            <Text variant="caption" tone="danger">
              {state.message}
            </Text>
          )}
          {state.kind === 'saved' && !changed && (
            <Text variant="caption" tone="secondary">
              Saved.
            </Text>
          )}
          <Button
            fullWidth
            loading={state.kind === 'saving'}
            disabled={!canSave}
            onPress={() => {
              void save();
            }}
          >
            Save
          </Button>
        </Stack>
      }
    >
      <Stack gap="lg">
        <Input
          label="Display name"
          value={name}
          onValueChange={(next) => {
            setDraftName(next);
            setState({ kind: 'idle' });
          }}
          autoComplete="name"
          maxLength={NAME_MAX + 10}
          error={draftName === null ? undefined : invalid}
          helper="Everyone in your groups sees this."
          disabled={loading}
        />

        <Stack gap="sm">
          <Row justify="between" align="baseline">
            <Text weight="semibold">Default currency</Text>
            {currency !== null && (
              <Text variant="caption" tone="secondary">
                {currency} · {CURRENCIES[currency].symbol}
              </Text>
            )}
          </Row>

          <Text variant="caption" tone="secondary">
            Used for new groups and expenses. Existing amounts keep the currency they were recorded
            in — nothing is ever converted.
          </Text>

          <Input
            label="Find a currency"
            value={query}
            onValueChange={setQuery}
            type="search"
            inputMode="search"
            placeholder="USD, rupee, yen…"
            helper={
              query.trim().length === 0
                ? 'Showing the most common. Type to search all 157.'
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
                  subtitle={code === currency ? 'Current default' : undefined}
                  trailing={
                    <Text aria-hidden tone={code === currency ? 'primary' : 'secondary'}>
                      {code === currency ? '✓' : CURRENCIES[code].symbol}
                    </Text>
                  }
                  chevron={false}
                  label={
                    code === currency
                      ? `${CURRENCIES[code].name}, current default`
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
      </Stack>
    </Screen>
  );
}
