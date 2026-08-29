/**
 * `/login` — the three sign-in methods (AC-A1.1), hand-built on the modular SDK.
 *
 * checklists/phase-03-auth.md §2 records why this is not FirebaseUI: that widget is web-only
 * and "does not port", so Phase 12 needs custom screens regardless, and its published peer
 * range stops two major versions below the SDK this project is on.
 *
 * ## This screen never navigates
 *
 * There is no `navigate()` in this file. Signing in changes the session; `<RedirectIfAuthed>`
 * is watching the session and stops rendering this route. That is deliberate, and it is the
 * whole reason the guard is a layout route: a Google popup, a submitted email form, an SMS
 * code, and a session that arrived in another tab all leave by the same door — so there is no
 * fourth code path to get wrong, and the stashed `/invite/:token` destination is honoured
 * identically for every one of them (AC-B3.3).
 *
 * ## Errors
 *
 * Everything thrown lands in one slot, through `describeAuthError` (docs/15: never a raw
 * Firebase code, never "Something went wrong"). The slot has a reserved height in
 * `auth.module.css` so an error appearing does not shove the buttons down under a thumb that
 * is already moving toward them.
 *
 * ## Article VIII
 *
 * The screen calls `../auth/firebaseAuth`, the only module in the app allowed to touch
 * `firebase/auth` for a credential. No Firestore, no `getAuthClient()`, and no profile write —
 * `authStore` runs `upsertUserProfile` off the session emission, so an account created here
 * gets its `users/{uid}` document without this screen knowing that happened (AC-A1.2).
 */

import { useCallback, useRef, useState, type FormEvent } from 'react';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

import { Button } from '../components/Button';
import { Screen, Stack } from '../components/Layout';
import { Input } from '../components/Input';
import { SegmentedControl } from '../components/SegmentedControl';
import { Text } from '../components/Text';
import styles from '../auth/auth.module.css';
import { describeAuthError } from '../auth/authErrors';
import { OrDivider, RecaptchaHost } from '../auth/RecaptchaHost';
import {
  confirmPhoneCode,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  startPhoneSignIn,
} from '../auth/firebaseAuth';

/* -------------------------------------------------------------------------- */
/* Modes                                                                      */
/* -------------------------------------------------------------------------- */

type Method = 'email' | 'phone';

const METHODS = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
] as const satisfies readonly { value: Method; label: string }[];

/**
 * Sign in to an existing account, or make a new one.
 *
 * One screen with a switch rather than two routes. `auth/invalid-credential` is deliberately
 * ambiguous about whether the account exists — the SDK collapses wrong-password and
 * user-not-found so an attacker cannot enumerate addresses (see `authErrors.ts`) — so a user
 * who mistyped cannot be told which of the two happened and routed accordingly. The only
 * workable recovery is for the other option to be one tap away on the screen they are already
 * looking at.
 */
type Intent = 'signIn' | 'signUp';

/** Signature of the shared "run a credential flow" helper the sub-forms are handed. */
type Attempt = (action: () => Promise<unknown>) => void;

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export function SignInScreen() {
  const [method, setMethod] = useState<Method>('email');
  const [error, setError] = useState<string | null>(null);
  /** One flag for the whole form: two credential attempts at once is never worth allowing. */
  const [busy, setBusy] = useState(false);

  const fail = useCallback((cause: unknown) => {
    setError(describeAuthError(cause));
  }, []);

  /**
   * Run a credential flow, funnelling every outcome into the two states above.
   *
   * 🔴 Note what is missing from the success path: nothing is set, and `busy` is deliberately
   * left `true`. The session listener has already fired by the time the promise resolves, so
   * this component is on its way out — clearing the flag would re-enable a form nobody can see
   * and re-render a tree React is unmounting.
   */
  const attempt = useCallback<Attempt>((action) => {
    setBusy(true);
    setError(null);
    void action().catch((cause: unknown) => {
      setError(describeAuthError(cause));
      setBusy(false);
    });
  }, []);

  return (
    <Screen label="Sign in to SplitSutra">
      <Stack gap="lg" justify="center" flex="1">
        <Stack gap="xs">
          <Text as="h1" variant="display">
            SplitSutra
          </Text>
          <Text tone="secondary">Split expenses with the people you actually live with.</Text>
        </Stack>

        <SegmentedControl
          label="Sign-in method"
          options={METHODS}
          value={method}
          onValueChange={(next) => {
            setMethod(next);
            setError(null);
          }}
        />

        {method === 'email' ? (
          <EmailForm busy={busy} attempt={attempt} />
        ) : (
          <PhoneForm busy={busy} attempt={attempt} onError={fail} />
        )}

        {/* Reserved height — see `.errorSlot`. `polite` so the message is announced without
            interrupting whatever the user is typing. */}
        <Stack className={styles.errorSlot} aria-live="polite">
          {error !== null && (
            <Text variant="caption" tone="danger">
              {error}
            </Text>
          )}
        </Stack>

        <OrDivider />

        <Button
          variant="secondary"
          fullWidth
          disabled={busy}
          onPress={() => {
            attempt(signInWithGoogle);
          }}
        >
          Continue with Google
        </Button>

        <Text variant="caption" tone="secondary" align="center">
          Your expenses stay between you and the people you share them with.
        </Text>
      </Stack>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Email + password                                                           */
/* -------------------------------------------------------------------------- */

interface FormProps {
  busy: boolean;
  attempt: Attempt;
}

function EmailForm({ busy, attempt }: FormProps) {
  const [intent, setIntent] = useState<Intent>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const signingUp = intent === 'signUp';
  const ready = email.trim().length > 0 && password.length > 0 && !busy;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!ready) return;
    attempt(() =>
      signingUp
        ? signUpWithEmail(email.trim(), password, displayName)
        : signInWithEmail(email.trim(), password),
    );
  }

  return (
    <form onSubmit={submit} className={styles.form}>
      <Input
        label="Email"
        value={email}
        onValueChange={setEmail}
        type="email"
        inputMode="email"
        /* Load-bearing, not decoration: without it a password manager cannot offer to fill,
           or to save the pair it is about to be handed. */
        autoComplete="email"
        placeholder="you@example.com"
        disabled={busy}
      />

      <Input
        label="Password"
        value={password}
        onValueChange={setPassword}
        type="password"
        autoComplete={signingUp ? 'new-password' : 'current-password'}
        helper={signingUp ? 'At least 6 characters.' : undefined}
        disabled={busy}
      />

      {signingUp && (
        <Input
          label="Your name"
          value={displayName}
          onValueChange={setDisplayName}
          autoComplete="name"
          maxLength={50}
          helper="How your friends will see you. You can change it later."
          disabled={busy}
        />
      )}

      <Button type="submit" fullWidth loading={busy} disabled={!ready}>
        {signingUp ? 'Create account' : 'Sign in'}
      </Button>

      <Button
        variant="ghost"
        fullWidth
        disabled={busy}
        onPress={() => {
          setIntent(signingUp ? 'signIn' : 'signUp');
        }}
      >
        {signingUp ? 'I already have an account' : 'Create an account'}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Phone / SMS OTP                                                            */
/* -------------------------------------------------------------------------- */

interface PhoneFormProps extends FormProps {
  onError: (cause: unknown) => void;
}

/**
 * Two steps in one component: ask for the number, then ask for the code.
 *
 * ⚠️ Every send costs real money and is the standard target for toll fraud, which is why the
 * SMS region policy is restricted to a single region (docs/18) and why the invisible reCAPTCHA
 * is not optional. The button is disabled while a request is in flight for the same reason: a
 * double-tap here is two messages, billed.
 */
function PhoneForm({ busy, attempt, onError }: PhoneFormProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  /** Written by `<RecaptchaHost>`, read at the moment Send is pressed. */
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  const awaitingCode = confirmation !== null;

  function sendCode(event: FormEvent): void {
    event.preventDefault();
    const verifier = verifierRef.current;
    if (verifier === null || phone.trim().length === 0 || busy) return;

    attempt(async () => {
      const result = await startPhoneSignIn(phone.trim(), verifier);
      // Reached only on success, so a failed send leaves the form on step one rather than
      // asking for a code that was never sent.
      setConfirmation(result);
    });
  }

  function submitCode(event: FormEvent): void {
    event.preventDefault();
    if (confirmation === null || code.length === 0 || busy) return;
    attempt(() => confirmPhoneCode(confirmation, code));
  }

  return (
    <form onSubmit={awaitingCode ? submitCode : sendCode} className={styles.form}>
      <Input
        label="Phone number"
        value={phone}
        onValueChange={(next) => {
          setPhone(next);
          // The handle confirms one specific number. Editing the number invalidates it, and
          // keeping it would verify a code against a number the user has already changed.
          setConfirmation(null);
          setCode('');
        }}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+14155550123"
        helper="Include the country code."
        disabled={busy}
      />

      {awaitingCode && (
        <Input
          label="Six-digit code"
          value={code}
          onValueChange={setCode}
          inputMode="numeric"
          /* `one-time-code` is what lets iOS and Android drop the SMS straight into the field
             instead of making someone memorise six digits and switch apps. */
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          disabled={busy}
        />
      )}

      <Button type="submit" fullWidth loading={busy} disabled={busy}>
        {awaitingCode ? 'Verify and sign in' : 'Send code'}
      </Button>

      <RecaptchaHost verifierRef={verifierRef} onError={onError} />
    </form>
  );
}
