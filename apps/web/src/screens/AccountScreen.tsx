/**
 * `/account` — who you are signed in as, your default currency, and the way out
 * (checklists/phase-03-auth.md §5, §7; AC-A3.1).
 *
 * ## Sign out does not navigate
 *
 * `signOut()` ends the session and returns. It does **not** call `navigate('/login')`, and the
 * absence is the design: `<RequireAuth>` is watching the session, so clearing it un-renders
 * every guarded route — this one included — and the redirect happens for free. A `navigate()`
 * here would be a second path to the same place that could disagree with the first, and it
 * would race the session listener: on a slow tick the router lands on `/login` while the user
 * is still technically signed in, and `<RedirectIfAuthed>` bounces them straight back.
 *
 * The same is true of every other device this account is signed in on, which is what makes
 * this correct rather than merely convenient.
 *
 * ## Two sources for the same person
 *
 * `user` is the Auth session (the provider's idea of you). `profile` is `users/{uid}` (the
 * editable one, AC-A2.1). Everything visible here comes from the profile, with the session
 * used only for the fields the profile does not carry — the address or number the account
 * signs in with. The distinction matters when they disagree: a user who renamed themselves in
 * this app should not see their Google name staring back at them.
 */

import { useState } from 'react';

import { CURRENCIES } from '@splitsutra/core';
import { useAuth, useProfile } from '@splitsutra/core/hooks';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Card, Row, Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths } from '../navigation/paths';

/**
 * The identifier this account signs in with, for the line under the name.
 *
 * Email first, then phone: an account can hold both, and the email is the one a person
 * recognises. Falls back to nothing rather than to the uid — a uid on screen is noise to
 * everyone who is not debugging.
 */
function signInIdentity(email: string | null, phoneNumber: string | null): string | undefined {
  return email ?? phoneNumber ?? undefined;
}

export function AccountScreen() {
  const { user, signOut } = useAuth();
  const { profile, loading } = useProfile();

  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endSession(): Promise<void> {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      // No `setSigningOut(false)`, and no navigation. See the header.
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? `Could not sign out: ${cause.message}`
          : 'Could not sign out. Check your connection and try again.',
      );
      setSigningOut(false);
    }
  }

  // `useProfile().loading` is true while the document is in flight AND while a missing one is
  // being repaired, so this covers first sign-in as well as a slow connection.
  const displayName = profile?.displayName ?? (loading ? '' : (user?.displayName ?? 'You'));
  const currency = profile?.defaultCurrency ?? null;

  return (
    <Screen header={<ScreenHeader title="Account" />}>
      <Stack gap="lg">
        <Card>
          <Row gap="md" align="center">
            <Avatar
              name={displayName.length > 0 ? displayName : 'You'}
              photoURL={profile?.photoURL ?? user?.photoURL ?? null}
              size="avatarLg"
            />
            <Stack gap="xs" flex="1">
              <Text variant="title" truncate>
                {displayName.length > 0 ? displayName : 'Loading…'}
              </Text>
              <Text variant="caption" tone="secondary" truncate>
                {signInIdentity(user?.email ?? null, user?.phoneNumber ?? null) ??
                  'Signed in to SplitSutra'}
              </Text>
            </Stack>
          </Row>
        </Card>

        <Card>
          <Stack gap="md">
            <Stack gap="xs">
              <Text variant="caption" tone="secondary" weight="medium">
                Default currency
              </Text>
              <Text>
                {currency === null ? 'Loading…' : `${currency} — ${CURRENCIES[currency].name}`}
              </Text>
              <Text variant="caption" tone="secondary">
                Used for new groups and expenses. Changing it never converts anything you have
                already recorded.
              </Text>
            </Stack>

            <Button variant="secondary" fullWidth to={paths.EditProfile()}>
              Edit profile
            </Button>
          </Stack>
        </Card>

        <Stack gap="sm" aria-live="polite">
          <Button
            variant="danger"
            fullWidth
            loading={signingOut}
            onPress={() => {
              void endSession();
            }}
          >
            Sign out
          </Button>

          {error !== null && (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          )}
        </Stack>
      </Stack>
    </Screen>
  );
}
