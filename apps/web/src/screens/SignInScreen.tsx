/**
 * `/login` — sign in and sign up, rendered by **FirebaseUI** (AC-A1.1).
 *
 * <https://firebase.google.com/docs/auth/web/firebaseui>
 *
 * The widget owns all three methods — email/password with account creation, phone OTP, and
 * Google — so this file is the frame around it: the wordmark, the error slot, and the
 * reassurance line. `auth/FirebaseUIMount.tsx` holds the configuration and, more importantly,
 * the compat bridge that lets the widget share the session core already initialised.
 *
 * ## This screen never navigates
 *
 * There is no `navigate()` here, and `signInSuccessWithAuthResult` returns `false` so the
 * widget does not redirect either. Signing in changes the session; `<RedirectIfAuthed>` is
 * watching it and stops rendering this route. That is the whole reason the guard is a layout
 * route: the widget, a session restored from persistence, and a session that arrived in
 * another tab all leave by the same door — so there is no second code path to get wrong, and
 * the stashed `/invite/:token` destination is honoured identically for all of them (AC-B3.3).
 *
 * ## Errors
 *
 * FirebaseUI renders its own inline validation for everything the user can fix in the form —
 * a bad password, a wrong SMS code. What reaches the slot below is the class it cannot handle
 * itself: a provider that is not switched on, an unauthorised domain, a broken config. Those
 * go through `describeAuthError` (docs/15: never a raw Firebase code, never "Something went
 * wrong"), and the slot has a reserved height in `auth.module.css` so an error appearing does
 * not shove the widget down under a thumb that is already moving.
 *
 * ## Article VIII
 *
 * No Firestore, and no profile write. `authStore` runs `upsertUserProfile` off the session
 * emission, so an account created here gets its `users/{uid}` document without this screen
 * knowing that happened (AC-A1.2).
 */

import { useCallback, useState } from 'react';

import { Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import styles from '../auth/auth.module.css';
import { describeAuthError } from '../auth/authErrors';
import { FirebaseUIMount } from '../auth/FirebaseUIMount';

export function SignInScreen() {
  const [error, setError] = useState<string | null>(null);

  // Stable identity: `FirebaseUIMount` has this in its effect's dependency array, and a new
  // function each render would tear the widget down and rebuild it on every keystroke.
  const fail = useCallback((cause: unknown) => {
    setError(describeAuthError(cause));
  }, []);

  return (
    <Screen label="Sign in to SplitSutra">
      <Stack gap="lg" justify="center" flex="1" className={styles.signInColumn}>
        <Stack gap="xs">
          <Text as="h1" variant="display">
            SplitSutra
          </Text>
          <Text tone="secondary">Split expenses with the people you actually live with.</Text>
        </Stack>

        <FirebaseUIMount onError={fail} />

        {/* Reserved height — see `.errorSlot`. `polite` so the message is announced without
            interrupting whatever the user is typing inside the widget. */}
        <Stack className={styles.errorSlot} aria-live="polite">
          {error !== null && (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          )}
        </Stack>

        <Text variant="caption" tone="secondary" align="center">
          Your expenses stay between you and the people you share them with.
        </Text>
      </Stack>
    </Screen>
  );
}
