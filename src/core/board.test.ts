import { describe, expect, test } from 'vitest';
import { Board, BLOCKER, SIZE } from './board';
import { parseSquare } from './dice';
import type { Cell } from './pieces';

const blockers = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'F1'].map(parseSquare);
const domino: Cell[] = [{ r: 0, c: 0 }, { r: 0, c: 1 }];

describe('Board', () => {
  test('is 6x6 and starts with the blockers filled and 29 empty cells', () => {
    const board = new Board(blockers);
    expect(SIZE).toBe(6);
    expect(board.get({ r: 0, c: 0 })).toBe(BLOCKER);
    expect(board.get({ r: 5, c: 5 })).toBe(BLOCKER);
    expect(board.get({ r: 0, c: 1 })).toBeNull();
    expect(board.emptyCount()).toBe(29);
  });

  test('canPlace rejects cells off the board', () => {
    const board = new Board(blockers);
    expect(board.canPlace(domino, { r: 0, c: 5 })).toBe(false);
    expect(board.canPlace(domino, { r: -1, c: 0 })).toBe(false);
    expect(board.canPlace(domino, { r: 6, c: 0 })).toBe(false);
  });

  test('canPlace rejects overlap with a blocker or a placed piece', () => {
    const board = new Board(blockers);
    expect(board.canPlace(domino, { r: 0, c: 0 })).toBe(false); // A1 is blocked
    board.place('domino', domino, { r: 0, c: 1 });
    expect(board.canPlace([{ r: 0, c: 0 }], { r: 0, c: 2 })).toBe(false);
    expect(board.canPlace([{ r: 0, c: 0 }], { r: 0, c: 3 })).toBe(true);
  });

  test('place fills the cells with the piece id and records the placement', () => {
    const board = new Board(blockers);
    board.place('domino', domino, { r: 2, c: 3 });
    expect(board.get({ r: 2, c: 3 })).toBe('domino');
    expect(board.get({ r: 2, c: 4 })).toBe('domino');
    expect(board.emptyCount()).toBe(27);
    expect(board.placements.get('domino')).toEqual({ cells: domino, at: { r: 2, c: 3 } });
  });

  test('place throws on an illegal spot and on a piece already on the board', () => {
    const board = new Board(blockers);
    expect(() => board.place('domino', domino, { r: 0, c: 0 })).toThrow();
    board.place('domino', domino, { r: 2, c: 3 });
    expect(() => board.place('domino', domino, { r: 4, c: 0 })).toThrow(/already/);
  });

  test('remove clears the piece and frees its cells', () => {
    const board = new Board(blockers);
    board.place('domino', domino, { r: 2, c: 3 });
    board.remove('domino');
    expect(board.get({ r: 2, c: 3 })).toBeNull();
    expect(board.emptyCount()).toBe(29);
    expect(board.placements.has('domino')).toBe(false);
    expect(board.canPlace(domino, { r: 2, c: 3 })).toBe(true);
  });

  test('isSolved is true only when no empty cells remain', () => {
    const nearlyFull: Cell[] = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (r !== 5 || c !== 5) nearlyFull.push({ r, c });
    const board = new Board(nearlyFull);
    expect(board.isSolved()).toBe(false);
    board.place('dot', [{ r: 0, c: 0 }], { r: 5, c: 5 });
    expect(board.isSolved()).toBe(true);
  });

  test('clone is independent of the original', () => {
    const board = new Board(blockers);
    const copy = board.clone();
    copy.place('domino', domino, { r: 2, c: 3 });
    expect(board.get({ r: 2, c: 3 })).toBeNull();
    expect(board.placements.size).toBe(0);
  });
});
