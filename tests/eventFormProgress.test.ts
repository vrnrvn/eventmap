import { describe, expect, it } from 'vitest';
import { progressLine, requiredFieldStatus, type RequiredFieldInput } from '@/utils/eventFormProgress';

const complete: RequiredFieldInput = {
  title: 'Jazz Night',
  description: 'Live quartet',
  categoryId: 'cat-1',
  startInFuture: true,
  endAfterStart: true,
  placeMissing: false,
};

describe('requiredFieldStatus', () => {
  it('is ready when every required field is in', () => {
    const s = requiredFieldStatus(complete);
    expect(s.ready).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.done).toBe(s.total);
  });

  it('lists what a blank form still needs, in page order', () => {
    const s = requiredFieldStatus({ ...complete, title: '  ', description: '', categoryId: '' });
    expect(s.missing.map((f) => f.key)).toEqual(['title', 'description', 'categoryId']);
    expect(s.done).toBe(3);
    expect(s.ready).toBe(false);
  });

  it('treats the place as a field only when the host has to set one', () => {
    expect(requiredFieldStatus({ ...complete, placeMissing: true }).missing.map((f) => f.label)).toEqual(['Place']);
    expect(requiredFieldStatus({ ...complete, placeMissing: false }).missing).toEqual([]);
  });

  it('counts a start in the past and an end before the start', () => {
    const s = requiredFieldStatus({ ...complete, startInFuture: false, endAfterStart: false });
    expect(s.missing.map((f) => f.label)).toEqual(['Start time', 'End time']);
  });
});

describe('progressLine', () => {
  it('says ready when it is', () => {
    expect(progressLine(requiredFieldStatus(complete))).toBe('Ready to publish');
  });

  it('names up to three missing fields', () => {
    const s = requiredFieldStatus({ ...complete, title: '', categoryId: '' });
    expect(progressLine(s)).toBe('Still needed: Title, Category');
    const three = requiredFieldStatus({ ...complete, title: '', description: '', categoryId: '' });
    expect(progressLine(three)).toBe('Still needed: Title, Description, Category');
  });

  it('counts the rest past three', () => {
    const s = requiredFieldStatus({ ...complete, title: '', description: '', categoryId: '', placeMissing: true });
    expect(progressLine(s)).toBe('Still needed: Title, Description and 2 more');
  });
});
