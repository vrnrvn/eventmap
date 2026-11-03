import { describe, expect, it } from 'vitest';
import {
  RsvpError,
  classifyRsvpError,
  rsvpErrorMessage,
  rsvpErrorNeedsRefresh,
} from '../utils/rsvpErrors';

describe('classifyRsvpError', () => {
  it('maps the join_event_with_capacity exception messages', () => {
    expect(classifyRsvpError({ code: 'P0001', message: 'EVENT_FULL' })).toBe('EVENT_FULL');
    expect(classifyRsvpError({ code: 'P0001', message: 'event_closed' })).toBe('EVENT_CLOSED');
    expect(classifyRsvpError({ code: 'P0001', message: 'event_not_found' })).toBe('NOT_FOUND');
    expect(
      classifyRsvpError({ code: 'P0001', message: 'not_allowed: account suspended' })
    ).toBe('SUSPENDED');
    expect(classifyRsvpError({ code: 'P0001', message: 'not_authenticated' })).toBe(
      'NOT_AUTHENTICATED'
    );
  });

  it('maps the waitlist RPC hints', () => {
    expect(classifyRsvpError({ code: 'P0001', message: 'spot_available' })).toBe('SPOT_AVAILABLE');
    expect(classifyRsvpError({ code: 'P0001', message: 'already_going' })).toBe('ALREADY_GOING');
    expect(
      classifyRsvpError({ code: 'P0001', message: 'waitlist_not_needed: event has no capacity limit' })
    ).toBe('WAITLIST_NOT_NEEDED');
  });

  it('keeps the server hint reachable through a wrapped RsvpError', () => {
    const wrapped = new RsvpError(classifyRsvpError({ message: 'spot_available' }), { message: 'spot_available' });
    expect(classifyRsvpError(wrapped)).toBe('SPOT_AVAILABLE');
  });

  it('is case-insensitive and also inspects details', () => {
    expect(classifyRsvpError({ message: 'Event_Full' })).toBe('EVENT_FULL');
    expect(classifyRsvpError({ message: 'P0001', details: 'event_closed' })).toBe(
      'EVENT_CLOSED'
    );
  });

  it('treats an RLS rejection on the rsvps table as closed', () => {
    expect(
      classifyRsvpError({
        code: '42501',
        message: 'new row violates row-level security policy for table "rsvps"',
      })
    ).toBe('EVENT_CLOSED');
  });

  it('falls back to UNKNOWN for anything else', () => {
    expect(classifyRsvpError(new Error('network down'))).toBe('UNKNOWN');
    expect(classifyRsvpError(null)).toBe('UNKNOWN');
    expect(classifyRsvpError(undefined)).toBe('UNKNOWN');
    expect(classifyRsvpError('EVENT_FULL')).toBe('UNKNOWN');
  });

  it('passes through an existing RsvpError code', () => {
    expect(classifyRsvpError(new RsvpError('EVENT_FULL'))).toBe('EVENT_FULL');
  });
});

describe('RsvpError', () => {
  it('carries the code and the user-facing message', () => {
    const err = new RsvpError('EVENT_CLOSED', { code: 'P0001' });
    expect(err.code).toBe('EVENT_CLOSED');
    expect(err.message).toBe(rsvpErrorMessage('EVENT_CLOSED'));
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: unknown }).cause).toEqual({ code: 'P0001' });
  });
});

describe('rsvpErrorNeedsRefresh', () => {
  it('refreshes when the event state changed under the user', () => {
    expect(rsvpErrorNeedsRefresh('EVENT_FULL')).toBe(true);
    expect(rsvpErrorNeedsRefresh('EVENT_CLOSED')).toBe(true);
    expect(rsvpErrorNeedsRefresh('NOT_FOUND')).toBe(true);
    expect(rsvpErrorNeedsRefresh('SPOT_AVAILABLE')).toBe(true);
    expect(rsvpErrorNeedsRefresh('ALREADY_GOING')).toBe(true);
  });

  it('does not refresh for account or transport problems', () => {
    expect(rsvpErrorNeedsRefresh('SUSPENDED')).toBe(false);
    expect(rsvpErrorNeedsRefresh('NOT_AUTHENTICATED')).toBe(false);
    expect(rsvpErrorNeedsRefresh('UNKNOWN')).toBe(false);
  });
});

describe('rsvpErrorMessage', () => {
  it('has distinct copy per code', () => {
    const codes = [
      'EVENT_FULL',
      'EVENT_CLOSED',
      'SUSPENDED',
      'NOT_FOUND',
      'NOT_AUTHENTICATED',
      'SPOT_AVAILABLE',
      'ALREADY_GOING',
      'WAITLIST_NOT_NEEDED',
      'UNKNOWN',
    ] as const;
    const messages = new Set(codes.map(rsvpErrorMessage));
    expect(messages.size).toBe(codes.length);
  });
});
