import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from '@/utils/eventLinks';

describe('normalizeLinkUrl', () => {
  it('keeps a full https URL', () => {
    expect(normalizeLinkUrl('https://example.com/tickets')).toBe('https://example.com/tickets');
  });

  it('adds https to a bare domain', () => {
    expect(normalizeLinkUrl('example.com/tickets')).toBe('https://example.com/tickets');
    expect(normalizeLinkUrl('  www.example.com  ')).toBe('https://www.example.com/');
  });

  it('allows plain http', () => {
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects empty and whitespace input', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
  });

  it('rejects non-web schemes', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('mailto:a@b.com')).toBeNull();
    expect(normalizeLinkUrl('tel:+15551234')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
  });

  it('rejects things that are not hostnames', () => {
    expect(normalizeLinkUrl('not a url')).toBeNull();
    expect(normalizeLinkUrl('localhost')).toBeNull();
  });
});
