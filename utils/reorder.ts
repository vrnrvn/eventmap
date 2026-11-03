/**
 * Pure list-reordering helpers for drag-and-drop grids. Kept dependency-free
 * so the index maths can be unit tested without a renderer.
 */

/** Moves the item at `from` to `to`, returning a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  const target = Math.min(Math.max(to, 0), list.length - 1);
  if (from === target) return list;
  const next = [...list];
  const [picked] = next.splice(from, 1);
  next.splice(target, 0, picked);
  return next;
}

/** Number of columns that fit in `width` for fixed-size cells. */
export function columnsForWidth(width: number, cellSize: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (cellSize + gap)));
}

/** Top-left offset of slot `index` in a fixed grid. */
export function slotPosition(
  index: number,
  columns: number,
  cellSize: number,
  gap: number
): { x: number; y: number } {
  'worklet';
  const cols = Math.max(1, columns);
  const step = cellSize + gap;
  return { x: (index % cols) * step, y: Math.floor(index / cols) * step };
}

/**
 * Which slot a dragged cell's centre currently sits over, clamped to the
 * list. Used to decide where a drop would land.
 */
export function slotIndexAt(
  centerX: number,
  centerY: number,
  columns: number,
  cellSize: number,
  gap: number,
  itemCount: number
): number {
  // Runs on Reanimated's UI thread from the drag gesture, so it must be a
  // worklet. The directive is an inert string under plain JS (and in tests).
  'worklet';
  if (itemCount <= 0) return 0;
  const cols = Math.max(1, columns);
  const step = cellSize + gap;
  const col = Math.min(Math.max(Math.floor(centerX / step), 0), cols - 1);
  const row = Math.max(Math.floor(centerY / step), 0);
  return Math.min(row * cols + col, itemCount - 1);
}

/** Rows needed to lay out `count` cells in `columns` columns. */
export function gridHeight(
  count: number,
  columns: number,
  cellSize: number,
  gap: number
): number {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / Math.max(1, columns));
  return rows * (cellSize + gap) - gap;
}
