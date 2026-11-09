import { describe, expect, it } from 'vitest';
import { validationSummary } from '@/utils/validationSummary';

describe('validationSummary', () => {
  it('counts fields and reads the first message', () => {
    expect(validationSummary({ title: 'Title is required', category: 'Pick a category' })).toBe(
      '2 fields need attention. Title is required.'
    );
  });
  it('singular, keeps existing punctuation, ignores empty entries', () => {
    expect(validationSummary({ title: '', end: 'End must be after start.' })).toBe(
      '1 field needs attention. End must be after start.'
    );
  });
  it('nothing to say when valid', () => {
    expect(validationSummary({})).toBe('');
  });
});
