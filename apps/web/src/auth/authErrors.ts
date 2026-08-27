/**
 * Firebase Auth error codes -> sentences a person can act on.
 *
 * docs/15 §Error messages: "Every error answers three questions: **what happened, why, and
 * what now.** Never surface a raw Firebase error code. Never say 'Something went wrong.'"
 *
 * A raw `auth/invalid-credential` on a sign-in form is the worst version of this: it is
 * simultaneously frightening, uninformative, and un-Googleable by the person who hit it.
 *
 * The map is deliberately exhaustive about the codes this app can actually produce, and
 * falls back to a message that still says what to do next.
 */

import { FirebaseError } from 'firebase/app';

const MESSAGES: Readonly<Record<string, string>> = {
  /* --- Email + password --------------------------------------------------- */
  'auth/invalid-email': 'That does not look like an email address. Check it and try again.',
  'auth/missing-password': 'Enter your password to continue.',
  /* Modern SDKs collapse wrong-password and user-not-found into this one code on purpose,
     so an attacker cannot use the error to discover which addresses have accounts. The
     copy has to stay vague for the same reason — but it can still say what to do. */
  'auth/invalid-credential':
    'That email and password do not match. Try again, or create an account.',
  'auth/wrong-password': 'That password is not right. Try again.',
  'auth/user-not-found': 'No account for that email yet. Create one below.',
  'auth/email-already-in-use': 'There is already an account with that email. Sign in instead.',
  'auth/weak-password': 'Passwords need at least 6 characters. Try a longer one.',
  'auth/user-disabled': 'This account has been disabled. Contact support to reopen it.',

  /* --- Google popup ------------------------------------------------------- */
  'auth/popup-closed-by-user': 'The Google window closed before sign-in finished. Try again.',
  'auth/cancelled-popup-request': 'The Google window closed before sign-in finished. Try again.',
  'auth/popup-blocked':
    'Your browser blocked the Google sign-in window. Allow popups for this site, or sign in with email.',
  /* AC-A1.4 — one account per address. Until the linking flow lands, the honest instruction
     is to use the method that already owns the address. */
  'auth/account-exists-with-different-credential':
    'You already have an account with that email using a different sign-in method. Use that one, and you can link the two afterwards.',

  /* --- Phone / OTP -------------------------------------------------------- */
  'auth/invalid-phone-number': 'Enter your number with the country code, like +919876543210.',
  'auth/missing-phone-number': 'Enter your phone number to get a code.',
  'auth/invalid-verification-code': 'That code is not right. Check the SMS and re-enter it.',
  'auth/code-expired': 'That code has expired. Ask for a new one.',
  'auth/quota-exceeded': 'Too many codes requested from this number today. Try again tomorrow.',
  'auth/captcha-check-failed': 'The security check did not pass. Reload the page and try again.',

  /* --- Environment -------------------------------------------------------- */
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes, then try again.',
  'auth/network-request-failed': "You're offline. Reconnect and try again.",
  'auth/operation-not-allowed':
    'That sign-in method is not switched on for this project yet. Enable it in the Firebase console.',
  'auth/unauthorized-domain':
    'This domain is not on the Firebase authorised list. Add it under Authentication → Settings.',
  'auth/invalid-api-key':
    'The Firebase config in this build is not valid. Check apps/web/.env.local.',
};

/**
 * Turn anything thrown by the auth layer into copy for an inline error.
 *
 * A config error from `readFirebaseConfig()` arrives here as a plain `Error` whose message
 * is already written for a human, so it is passed through rather than flattened into the
 * generic fallback.
 */
export function describeAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    const known = MESSAGES[error.code];
    if (known !== undefined) return known;
    // Unknown Firebase code. Say what we know and what to do — never the bare code.
    return 'Sign-in did not go through. Check your details and try again.';
  }

  if (error instanceof Error && error.message.startsWith('[splitsutra]')) {
    return error.message.replace('[splitsutra] ', '');
  }

  return 'Sign-in did not go through. Check your connection and try again.';
}
