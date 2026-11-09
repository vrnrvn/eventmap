import { describe, expect, it } from 'vitest';
import { escapeLike, orIlike } from '../admin/app/(dashboard)/SearchForm';

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
