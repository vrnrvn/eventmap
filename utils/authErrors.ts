/**
 * Maps Supabase/GoTrue auth failures to messages that tell the user what to do
 * next. Raw `error.message` leaks internal phrasing ("Invalid login
 * credentials", "AuthApiError: …") and, for cases like an unconfirmed email,
 * gives no next step at all.
 *
 * Unrecognised errors fall back to the caller's generic message rather than the
 * raw string, so a new GoTrue error can never surface server internals — at the
 * cost of being vaguer, which is the right trade for an auth screen.
 */

import { TIMEOUT_MESSAGE, classifyError } from './networkErrors';

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";

type MaybeAuthError = {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
};

/** Ordered: first match wins, so put specific patterns before general ones. */
const PATTERNS: { match: RegExp; message: string }[] = [
  {
    match: /invalid login credentials|invalid email or password|invalid credentials/,
    message: 'That email or password is not right. Check both and try again.',
  },
  {
    match: /email not confirmed|email address not confirmed/,
    message: 'Confirm your email first — check your inbox for the verification link.',
  },
  {
    match: /user already registered|already been registered|already exists|email exists/,
    message: 'An account with that email already exists. Try signing in instead.',
  },
  {
    match: /password should be at least|password is too short/,
    message: 'That password is too short. Use at least 8 characters.',
  },
  {
    match: /weak password|password is too weak/,
    message: 'That password is too easy to guess. Try a longer or less common one.',
  },
  {
    match: /same.*as.*old password|new password should be different|same password/,
    message: 'That is already your current password. Choose a different one.',
  },
  {
    // GoTrue phrases the per-email cooldown as "For security purposes, you can
    // only request this after N seconds" — no "rate limit" anywhere in it.
    match:
      /email rate limit|over_email_send_rate_limit|too many requests|rate limit|for security purposes|only request this after/,
    message: 'Too many attempts. Wait a minute and try again.',
  },
  {
    match: /token has expired|otp_expired|link is invalid or has expired|expired/,
    message: 'That link has expired. Request a new one.',
  },
  {
    match: /reauthentication|session.*expired|jwt expired|invalid refresh token/,
    message: 'Your session expired. Sign in again to continue.',
  },
  {
    match: /signups not allowed|signup is disabled|signup disabled/,
    message: 'New sign-ups are currently disabled.',
  },
  {
    match: /user not found/,
    message: 'No account matches that email.',
  },
  {
    match: /network request failed|failed to fetch|network error/,
    message: NETWORK_MESSAGE,
  },
  {
    match: /cancel/,
    message: 'Sign-in was cancelled.',
  },
];

export function authErrorMessage(error: unknown, fallback: string): string {
  const err = error as MaybeAuthError | null;
  if (!err) return fallback;

  // Connection failures first: AuthRetryableFetchError and timeouts don't
  // always carry "network" wording for the patterns below to catch.
  const connection = classifyError(err);
  if (connection === 'network') return NETWORK_MESSAGE;
  if (connection === 'timeout') return TIMEOUT_MESSAGE;

  const haystack = [err.code, err.message, err.name]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();

  if (!haystack.trim()) return fallback;

  // GoTrue sends machine codes with underscores (`weak_password`) and prose
  // with spaces ("Password is too weak") for the same condition. Match against
  // both forms so one set of patterns covers either.
  const searchable = `${haystack} ${haystack.replace(/_/g, ' ')}`;

  for (const { match, message } of PATTERNS) {
    if (match.test(searchable)) return message;
  }

  // Our own thrown Errors carry copy written for users; Supabase's do not.
  // AuthApiError/AuthError are the supabase-js classes.
  const isSupabaseError =
    typeof err.name === 'string' && /^auth(api|retryable|session|weakpassword)?error$/i.test(err.name);
  if (!isSupabaseError && typeof err.message === 'string' && err.message.trim()) {
    return err.message;
  }

  return fallback;
}
