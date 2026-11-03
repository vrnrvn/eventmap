import { describe, expect, it } from 'vitest';
import {
  columnsForWidth,
  gridHeight,
  moveItem,
  slotIndexAt,
  slotPosition,
} from '@/utils/reorder';

const CELL = 100;
const GAP = 8;

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves forward and backward', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('promoting to 0 makes an item the cover', () => {
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns the same reference when nothing moves', () => {
    expect(moveItem(list, 1, 1)).toBe(list);
  });

  it('clamps an out-of-range destination', () => {
    expect(moveItem(list, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveItem(list, 3, -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('ignores an out-of-range source', () => {
    expect(moveItem(list, 9, 0)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
  });

  it('does not mutate the input', () => {
    const copy = [...list];
    moveItem(list, 0, 3);
    expect(list).toEqual(copy);
  });
});

describe('columnsForWidth', () => {
  it('fits as many whole cells as the width allows', () => {
    expect(columnsForWidth(100, CELL, GAP)).toBe(1);
    expect(columnsForWidth(207, CELL, GAP)).toBe(1); // two cells need 208
    expect(columnsForWidth(208, CELL, GAP)).toBe(2); // 100 + 8 + 100
    expect(columnsForWidth(315, CELL, GAP)).toBe(2); // three cells need 316
    expect(columnsForWidth(316, CELL, GAP)).toBe(3);
  });

  it('never returns less than one column', () => {
    expect(columnsForWidth(0, CELL, GAP)).toBe(1);
    expect(columnsForWidth(-10, CELL, GAP)).toBe(1);
    expect(columnsForWidth(NaN, CELL, GAP)).toBe(1);
  });
});

describe('slotPosition', () => {
  it('lays cells out left to right, wrapping by column count', () => {
    expect(slotPosition(0, 3, CELL, GAP)).toEqual({ x: 0, y: 0 });
    expect(slotPosition(2, 3, CELL, GAP)).toEqual({ x: 216, y: 0 });
    expect(slotPosition(3, 3, CELL, GAP)).toEqual({ x: 0, y: 108 });
    expect(slotPosition(4, 3, CELL, GAP)).toEqual({ x: 108, y: 108 });
  });
});

describe('slotIndexAt', () => {
  it('maps a point back to the slot under it', () => {
    expect(slotIndexAt(10, 10, 3, CELL, GAP, 6)).toBe(0);
    expect(slotIndexAt(220, 10, 3, CELL, GAP, 6)).toBe(2);
    expect(slotIndexAt(10, 120, 3, CELL, GAP, 6)).toBe(3);
  });

  it('round-trips with slotPosition', () => {
    for (let i = 0; i < 7; i++) {
      const { x, y } = slotPosition(i, 3, CELL, GAP);
      expect(slotIndexAt(x + CELL / 2, y + CELL / 2, 3, CELL, GAP, 7)).toBe(i);
    }
  });

  it('clamps past the end of the list and past the last column', () => {
    expect(slotIndexAt(999, 999, 3, CELL, GAP, 4)).toBe(3);
    expect(slotIndexAt(-50, -50, 3, CELL, GAP, 4)).toBe(0);
  });

  it('returns 0 for an empty list', () => {
    expect(slotIndexAt(50, 50, 3, CELL, GAP, 0)).toBe(0);
  });
});

describe('gridHeight', () => {
  it('excludes the trailing gap', () => {
    expect(gridHeight(3, 3, CELL, GAP)).toBe(100);
    expect(gridHeight(4, 3, CELL, GAP)).toBe(208);
    expect(gridHeight(0, 3, CELL, GAP)).toBe(0);
  });
});
