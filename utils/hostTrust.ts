import type { Business, HostStanding, HostVerificationRequest } from '@/types/database';

/**
 * Host trust (HOST_ONBOARDING_PLAN.md §4 Stage 7, §18): verification state,
 * standing, and the server errors that come from them. Pure, so the copy and
 * the rules are tested without a renderer. The server enforces the same rules
 * (migrations 20261110140000 / 150000); this module explains them.
 */

// ── Verification ─────────────────────────────────────────────────────────────

export type VerificationState =
  | { kind: 'verified' }
  | { kind: 'pending'; request: HostVerificationRequest }
  | { kind: 'needs_info'; request: HostVerificationRequest }
  | { kind: 'rejected'; request: HostVerificationRequest }
  | { kind: 'not_requested' }
  /** The backend does not have verification requests yet. */
  | { kind: 'unavailable' };

export function verificationState(
  business: Pick<Business, 'verified'> | null | undefined,
  latest: HostVerificationRequest | null | 'unavailable'
): VerificationState {
  if (business?.verified) return { kind: 'verified' };
  if (latest === 'unavailable') return { kind: 'unavailable' };
  if (!latest) return { kind: 'not_requested' };
  switch (latest.status) {
    case 'pending':
      return { kind: 'pending', request: latest };
    case 'needs_info':
      return { kind: 'needs_info', request: latest };
    case 'rejected':
      return { kind: 'rejected', request: latest };
    // Approved but `verified` not yet reflected (stale business row): show
    // as verified rather than inviting a duplicate request.
    case 'approved':
      return { kind: 'verified' };
  }
}

/** Whether the host may (re)submit now, from what the client can see. */
export function canRequestVerification(
  state: VerificationState,
  standing: HostStanding,
  archived = false
): boolean {
  if (standing === 'restricted' || archived) return false;
  return state.kind === 'not_requested' || state.kind === 'needs_info' || state.kind === 'rejected';
}

/**
 * Eligibility mirrors submit_verification_request: a description and at
 * least one published event. Returns the first missing step, or null.
 * `publishedEvents` null = unknown; the server decides in that case.
 */
export function verificationBlocker(input: {
  description: string | null | undefined;
  publishedEvents: number | null;
}): string | null {
  if (!input.description?.trim()) return 'Add a description to your host profile first.';
  if (input.publishedEvents === 0) return 'Publish an event first, so there is something to check.';
  return null;
}

const URL_RE = /^https?:\/\/\S+\.\S+$/i;

export function normaliseEvidenceUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return URL_RE.test(withScheme) && withScheme.length <= 500 ? withScheme : null;
}

export const VERIFICATION_COPY: Record<VerificationState['kind'], { title: string; body: string }> = {
  verified: { title: 'Verified', body: 'Your host page and events show a verified badge.' },
  pending: { title: 'Verification requested', body: 'EventMap is reviewing your request. This usually takes a few days.' },
  needs_info: { title: 'More information needed', body: 'EventMap needs a bit more before verifying you.' },
  rejected: { title: 'Not verified', body: 'Your last request was not approved. You can try again with a different link.' },
  not_requested: {
    title: 'Get verified',
    body: 'A verified badge tells attendees you are who you say you are. Share a link EventMap can check, like your website or Instagram.',
  },
  unavailable: { title: 'Verification', body: 'Verification requests will be available after the next server update.' },
};

// ── Standing ─────────────────────────────────────────────────────────────────

export function effectiveStanding(b: Pick<Business, 'standing'> | null | undefined): HostStanding {
  return b?.standing ?? 'good';
}

/**
 * Banner for an archived host, a warning or a restriction; null when all is
 * well. Archived comes first: it is the host's own choice and explains why
 * publishing is off.
 */
export function standingNotice(
  b: Pick<Business, 'standing' | 'standing_reason' | 'archived_at'> | null | undefined
): { tone: 'warning' | 'danger'; title: string; body: string } | null {
  if (b?.archived_at) {
    return {
      tone: 'warning',
      title: 'You stopped hosting',
      body: 'Your host profile is closed and your events are no longer listed. Reopen it in Settings to publish again.',
    };
  }
  const standing = effectiveStanding(b);
  if (standing === 'good') return null;
  const reason = b?.standing_reason?.trim();
  if (standing === 'warning') {
    return {
      tone: 'warning',
      title: 'Your account has a warning',
      body: `${reason ? `${reason} ` : ''}You can keep hosting; repeated issues may pause publishing.`,
    };
  }
  return {
    tone: 'danger',
    title: 'Publishing is paused',
    body: `${reason ? `${reason} ` : ''}You can still edit drafts and manage existing events. Contact support to appeal.`,
  };
}

// ── Server errors ────────────────────────────────────────────────────────────

export type TrustErrorKind =
  | 'host_archived'
  | 'host_restricted'
  | 'guidelines_required'
  | 'already_verified'
  | 'request_pending'
  | 'not_eligible'
  | 'invalid_evidence_url';

/** Maps a server error from the trust guards / RPCs to a kind, or null. */
export function trustErrorKind(err: unknown): TrustErrorKind | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? '');
  const kinds: TrustErrorKind[] = [
    'host_archived',
    'host_restricted',
    'guidelines_required',
    'already_verified',
    'request_pending',
    'not_eligible',
    'invalid_evidence_url',
  ];
  return kinds.find((k) => msg.includes(k)) ?? null;
}

export function trustErrorMessage(kind: TrustErrorKind, err?: unknown): string {
  switch (kind) {
    case 'host_archived':
      return 'You stopped hosting. Reopen your host profile in Settings to publish again.';
    case 'host_restricted':
      return 'Publishing is paused for your account. Your draft is saved; see Settings → Host profile for why.';
    case 'guidelines_required':
      return 'Accept the host guidelines to publish.';
    case 'already_verified':
      return 'You are already verified.';
    case 'request_pending':
      return 'Your request is already being reviewed.';
    case 'invalid_evidence_url':
      return 'Enter a full web address, like https://yoursite.com.';
    case 'not_eligible': {
      // The server says which step is missing after the colon.
      const msg = String((err as { message?: unknown } | null)?.message ?? '');
      const detail = msg.split('not_eligible:')[1]?.trim();
      return detail ? `${detail[0].toUpperCase()}${detail.slice(1)}.` : 'You are not eligible to request verification yet.';
    }
  }
}

// ── Appeal ───────────────────────────────────────────────────────────────────

export const SUPPORT_EMAIL = 'support@eventmap.com';

/**
 * A pre-filled appeal email for a restricted host. A real in-app appeal
 * (a record an admin can act on) needs its own table and queue — see the
 * plan's Stage 6 remaining items; this is the honest interim.
 */
export function appealMailto(business: Pick<Business, 'id' | 'name' | 'standing' | 'standing_reason'>): string {
  const subject = `Appeal: publishing paused for ${business.name}`;
  const body = [
    `Host: ${business.name} (${business.id})`,
    `Reason given: ${business.standing_reason ?? 'not stated'}`,
    '',
    'Why I think this should be reviewed:',
    '',
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
