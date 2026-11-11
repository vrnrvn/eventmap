import { describe, expect, it } from 'vitest';
import {
  appealMailto,
  canRequestVerification,
  effectiveStanding,
  normaliseEvidenceUrl,
  standingNotice,
  trustErrorKind,
  trustErrorMessage,
  verificationBlocker,
  verificationState,
} from '@/utils/hostTrust';
import type { HostVerificationRequest } from '@/types/database';

const req = (status: HostVerificationRequest['status'], over: Partial<HostVerificationRequest> = {}): HostVerificationRequest => ({
  id: 'r1',
  business_id: 'b1',
  status,
  evidence_url: 'https://x.example',
  note: null,
  reviewer_note: null,
  reviewed_at: null,
  created_at: '2026-11-10T00:00:00Z',
  updated_at: '2026-11-10T00:00:00Z',
  ...over,
});

describe('verificationState', () => {
  it('verified wins over any request', () => {
    expect(verificationState({ verified: true }, req('pending')).kind).toBe('verified');
    expect(verificationState({ verified: true }, 'unavailable').kind).toBe('verified');
  });
  it('maps the latest request', () => {
    expect(verificationState({ verified: false }, null).kind).toBe('not_requested');
    expect(verificationState({ verified: false }, req('pending')).kind).toBe('pending');
    expect(verificationState({ verified: false }, req('needs_info')).kind).toBe('needs_info');
    expect(verificationState({ verified: false }, req('rejected')).kind).toBe('rejected');
    expect(verificationState({ verified: false }, 'unavailable').kind).toBe('unavailable');
  });
  it('an approved request with a stale business row reads as verified', () => {
    expect(verificationState({ verified: false }, req('approved')).kind).toBe('verified');
  });
});

describe('canRequestVerification', () => {
  it('allows a first request, an answer to needs_info, and a retry after rejection', () => {
    expect(canRequestVerification({ kind: 'not_requested' }, 'good')).toBe(true);
    expect(canRequestVerification({ kind: 'needs_info', request: req('needs_info') }, 'warning')).toBe(true);
    expect(canRequestVerification({ kind: 'rejected', request: req('rejected') }, 'good')).toBe(true);
  });
  it('not while pending, verified, unavailable or restricted', () => {
    expect(canRequestVerification({ kind: 'pending', request: req('pending') }, 'good')).toBe(false);
    expect(canRequestVerification({ kind: 'verified' }, 'good')).toBe(false);
    expect(canRequestVerification({ kind: 'unavailable' }, 'good')).toBe(false);
    expect(canRequestVerification({ kind: 'not_requested' }, 'restricted')).toBe(false);
  });
});

describe('verificationBlocker', () => {
  it('mirrors the server eligibility', () => {
    expect(verificationBlocker({ description: '', publishedEvents: 3 })).toMatch(/description/);
    expect(verificationBlocker({ description: 'Jazz', publishedEvents: 0 })).toMatch(/Publish an event/);
    expect(verificationBlocker({ description: 'Jazz', publishedEvents: 2 })).toBeNull();
    // Unknown count: let the server decide.
    expect(verificationBlocker({ description: 'Jazz', publishedEvents: null })).toBeNull();
  });
});

describe('normaliseEvidenceUrl', () => {
  it('adds https and rejects non-links', () => {
    expect(normaliseEvidenceUrl('instagram.com/trbar')).toBe('https://instagram.com/trbar');
    expect(normaliseEvidenceUrl('http://site.example')).toBe('http://site.example');
    expect(normaliseEvidenceUrl('not a url')).toBeNull();
    expect(normaliseEvidenceUrl('   ')).toBeNull();
    expect(normaliseEvidenceUrl(`https://x.example/${'a'.repeat(600)}`)).toBeNull();
  });
});

describe('standing', () => {
  it('legacy rows are in good standing with no notice', () => {
    expect(effectiveStanding({})).toBe('good');
    expect(standingNotice({})).toBeNull();
    expect(standingNotice({ standing: 'good', standing_reason: null })).toBeNull();
  });
  it('warning and restricted show the reason', () => {
    const w = standingNotice({ standing: 'warning', standing_reason: 'Late cancellations.' });
    expect(w).toMatchObject({ tone: 'warning' });
    expect(w?.body).toContain('Late cancellations.');
    const r = standingNotice({ standing: 'restricted', standing_reason: 'Misleading listings.' });
    expect(r).toMatchObject({ tone: 'danger', title: 'Publishing is paused' });
    expect(r?.body).toMatch(/drafts/);
  });
});

describe('trust errors', () => {
  it('recognises the guard and RPC errors', () => {
    expect(trustErrorKind({ message: 'host_restricted: publishing is paused for this host' })).toBe('host_restricted');
    expect(trustErrorKind({ message: 'guidelines_required: accept the host guidelines to publish' })).toBe('guidelines_required');
    expect(trustErrorKind({ message: 'request_pending' })).toBe('request_pending');
    expect(trustErrorKind({ message: 'something else' })).toBeNull();
    expect(trustErrorKind(null)).toBeNull();
  });
  it('passes the server eligibility detail through', () => {
    expect(trustErrorMessage('not_eligible', { message: 'not_eligible: publish an event first' })).toBe('Publish an event first.');
    expect(trustErrorMessage('not_eligible')).toMatch(/not eligible/);
    expect(trustErrorMessage('host_restricted')).toMatch(/draft is saved/);
  });
});

describe('appeal', () => {
  it('pre-fills a support email with the host and the reason', () => {
    const url = appealMailto({ id: 'b1', name: 'The Blue Door', standing: 'restricted', standing_reason: 'Spam listings' });
    expect(url.startsWith('mailto:support@eventmap.com?')).toBe(true);
    expect(decodeURIComponent(url)).toContain('The Blue Door');
    expect(decodeURIComponent(url)).toContain('Spam listings');
  });
  it('survives a missing reason', () => {
    const url = appealMailto({ id: 'b1', name: 'X', standing: 'restricted', standing_reason: null });
    expect(decodeURIComponent(url)).toContain('not stated');
  });
});

describe('archived host', () => {
  it('shows its own notice and blocks verification requests', () => {
    const n = standingNotice({ standing: 'good', standing_reason: null, archived_at: '2026-11-10T00:00:00Z' });
    expect(n?.title).toBe('You stopped hosting');
    expect(canRequestVerification({ kind: 'not_requested' }, 'good', true)).toBe(false);
  });
  it('maps the archived publish error', () => {
    expect(trustErrorKind({ message: 'host_archived: reopen your host profile to publish again' })).toBe('host_archived');
    expect(trustErrorMessage('host_archived')).toMatch(/Reopen/);
  });
});
