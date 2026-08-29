/**
 * What renders when Firebase could not be initialised at startup.
 *
 * This exists because the alternative is a blank white page. `readFirebaseConfig()` throws on a
 * missing `.env.local`, and at module scope that throw lands before `createRoot`, so nothing
 * mounts and the only clue is a console line. That symptom is indistinguishable from a broken
 * build, and it is the first thing anyone cloning this repo will hit.
 *
 * docs/15 §Error messages: every error answers **what happened, why, and what now.** The thrown
 * message already names the missing variables, so it is shown verbatim rather than summarised.
 *
 * Deliberately renders OUTSIDE the router, and therefore outside `<AppShell>` and the tab bar:
 * the shell assumes a working session, and a tab bar here would offer five destinations that
 * cannot render either. `<Screen>` itself is fine — it is the scroll container, not the shell.
 */

import { Card, Screen, Stack } from '../components/Layout';
import { Text } from '../components/Text';

export interface SetupRequiredScreenProps {
  /** The startup failure. Its message is written to be read by a developer, and is shown as-is. */
  error: Error;
}

export function SetupRequiredScreen({ error }: SetupRequiredScreenProps) {
  return (
    <Screen label="Set up SplitSutra">
      <Stack gap="lg" justify="center" flex="1">
        <Stack gap="sm">
          <Text as="h1" variant="title">
            SplitSutra needs configuring
          </Text>
          <Text tone="secondary">
            The app started, but Firebase could not be initialised, so nothing can load yet.
          </Text>
        </Stack>

        <Card>
          <Text variant="caption" tone="danger">
            {error.message}
          </Text>
        </Card>

        <Stack gap="sm">
          <Text weight="semibold">To run against the local emulator suite</Text>
          <Text variant="caption" tone="secondary">
            Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code>, set{' '}
            <code>VITE_USE_EMULATORS=true</code> and <code>VITE_FIREBASE_PROJECT_ID</code> to a{' '}
            <code>demo-</code> prefixed id, then run <code>pnpm emulators</code>. A{' '}
            <code>demo-</code> id keeps the SDK offline, so no real project can be touched by
            accident.
          </Text>
        </Stack>

        <Stack gap="sm">
          <Text weight="semibold">To run against a real Firebase project</Text>
          <Text variant="caption" tone="secondary">
            Fill in the same file from Firebase console → Project settings → General → Your apps.
            Those values are public identifiers, not secrets — see the note at the top of{' '}
            <code>.env.example</code>.
          </Text>
        </Stack>
      </Stack>
    </Screen>
  );
}
