/**
 * "A new version is ready" — the visible half of `registerType: 'prompt'`.
 *
 * ## Why the update is not silent
 *
 * `autoUpdate` would swap the running bundle the moment a new worker activates. On most sites
 * that is invisible and correct. Here the central screen is a form somebody is part-way through
 * typing an amount into, and a reload discards it. So the worker waits, and the user chooses.
 *
 * ## Why this is not a screen
 *
 * It renders over whatever is on screen, on every route, so it belongs to the shell rather than
 * to any one of them. It still composes only design-system primitives, so Phase 12 ports it the
 * same way a screen would.
 *
 * 🔴 The import is a VIRTUAL module supplied by `vite-plugin-pwa`. It resolves in a real build
 *    and in `vite dev`, but not in Vitest, which is why `__tests__` stubs it rather than
 *    importing this file's dependency for real.
 */

import { useRegisterSW } from 'virtual:pwa-register/react';

import { Button } from '../components/Button';
import { Card, Row, Stack } from '../components/Layout';
import { Text } from '../components/Text';
import styles from './pwa.module.css';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <Stack className={styles.updateBar} aria-live="polite">
      <Card>
        <Row gap="md">
          <Stack gap="xs" flex="1">
            <Text weight="semibold">A new version is ready</Text>
            <Text variant="caption" tone="secondary">
              Reloading takes a second. Anything you are part-way through typing will be lost.
            </Text>
          </Stack>
          <Row gap="sm">
            <Button
              variant="ghost"
              size="compact"
              onPress={() => {
                // Dismissed, not deferred: the worker stays waiting and the prompt returns on
                // the next launch. Nothing is lost by saying "not now".
                setNeedRefresh(false);
              }}
            >
              Later
            </Button>
            <Button
              size="compact"
              onPress={() => {
                void updateServiceWorker(true);
              }}
            >
              Reload
            </Button>
          </Row>
        </Row>
      </Card>
    </Stack>
  );
}
