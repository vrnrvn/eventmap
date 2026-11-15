import { describe, expect, it } from 'vitest';
import { escapeLike, orIlike, uuidPrefixRange } from '../admin/app/(dashboard)/SearchForm';

/** Admin search runs in the PostgREST query (all pages), via `.or(...)`. */
describe('admin search filter', () => {
  it('builds one ilike per column', () => {
    expect(orIlike(['name', 'category'], 'jazz')).toBe('name.ilike.%jazz%,category.ilike.%jazz%');
  });

  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLike('100%_off\\')).toBe('100\\%\\_off\\\\');
    expect(orIlike(['title'], '50%')).toBe('title.ilike.%50\\%%');
  });

  it('neutralises .or() syntax characters (comma, parens, quotes)', () => {
    const f = orIlike(['name', 'category'], 'a,b (c) "d"');
    // Exactly two conditions: the comma in the term didn't add a third.
    expect(f.split(',')).toHaveLength(2);
    expect(f).not.toMatch(/[()"]/);
  });

  it('turns * (PostgREST wildcard) into a single-character match', () => {
    expect(escapeLike('a*b')).toBe('a_b');
  });
});

/** Admin Users search: a pasted id prefix becomes a uuid range (no LIKE on uuid). */
describe('uuidPrefixRange', () => {
  it('pads a hex prefix to the lowest and highest ids that start with it', () => {
    expect(uuidPrefixRange('1000')).toEqual({
      lo: '10000000-0000-0000-0000-000000000000',
      hi: '1000ffff-ffff-ffff-ffff-ffffffffffff',
    });
  });

  it('accepts a copied first block with or without the dash and upper case', () => {
    expect(uuidPrefixRange('10000000-')).toEqual(uuidPrefixRange('10000000'));
    expect(uuidPrefixRange('10000000-0000-4')?.lo).toBe('10000000-0000-4000-0000-000000000000');
    expect(uuidPrefixRange('ABCD')?.hi).toBe('abcdffff-ffff-ffff-ffff-ffffffffffff');
  });

  it('is null for names, for too-short prefixes, and for a complete uuid', () => {
    expect(uuidPrefixRange('alex')).toBeNull(); // 'alex' is not hex
    expect(uuidPrefixRange('abc')).toBeNull(); // 3 digits: too wide
    expect(uuidPrefixRange('10000000-0000-4000-8000-000000000002')).toBeNull();
    expect(uuidPrefixRange('')).toBeNull();
  });

  it('does not treat a name made of hex letters as an id unless it is only hex', () => {
    expect(uuidPrefixRange('cafe')).not.toBeNull(); // genuinely ambiguous, prefix wins
    expect(uuidPrefixRange('cafe bar')).toBeNull();
  });
});
