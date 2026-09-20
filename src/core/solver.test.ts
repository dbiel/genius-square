import { describe, expect, test } from 'vitest';
import { Board } from './board';
import { parseSquare, rollFromSeed } from './dice';
import { PIECES, type Cell } from './pieces';
import { solve, countSolutions, hint } from './solver';

function fullBoardFrom(seed: number): Board {
  return new Board(rollFromSeed(seed));
}

describe('solve', () => {
  test('fills every empty cell of a rolled board using all 9 pieces once', () => {
    const board = fullBoardFrom(0);
    const solution = solve(board);
    expect(solution).not.toBeNull();
    expect(solution!.size).toBe(9);
    const check = board.clone();
    for (const [id, p] of solution!) check.place(id, p.cells, p.at);
    expect(check.isSolved()).toBe(true);
  });

  test('does not modify the board it is given', () => {
    const board = fullBoardFrom(777);
    solve(board);
    expect(board.emptyCount()).toBe(29);
    expect(board.placements.size).toBe(0);
  });

  test('keeps pieces that are already placed and only returns the rest', () => {
    const board = fullBoardFrom(5);
    const full = solve(board)!;
    const square = full.get('square')!;
    board.place('square', square.cells, square.at);
    const rest = solve(board);
    expect(rest).not.toBeNull();
    expect(rest!.has('square')).toBe(false);
    expect(rest!.size).toBe(8);
    const check = board.clone();
    for (const [id, p] of rest!) check.place(id, p.cells, p.at);
    expect(check.isSolved()).toBe(true);
  });

  test('returns null when the board cannot be completed', () => {
    // Two single-cell holes: only the dot can fill one of them.
    const blockers: Cell[] = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) blockers.push({ r, c });
    const holes = ['A1', 'F6'].map(parseSquare);
    const board = new Board(blockers.filter((b) => !holes.some((h) => h.r === b.r && h.c === b.c)));
    expect(solve(board)).toBeNull();
  });

  test('each orientation in a solution is one of the piece orientations', () => {
    const solution = solve(fullBoardFrom(4242))!;
    for (const [id, p] of solution) {
      const piece = PIECES.find((x) => x.id === id)!;
      expect(piece.orientations).toContainEqual(p.cells);
    }
  });

  test('solves a fresh roll in well under 100 ms', () => {
    const start = performance.now();
    for (const seed of [1, 999, 31104, 62207]) expect(solve(fullBoardFrom(seed))).not.toBeNull();
    expect(performance.now() - start).toBeLessThan(400);
  });
});

describe('countSolutions', () => {
  test('counts distinct solutions and stops at the limit', () => {
    const board = fullBoardFrom(0);
    expect(countSolutions(board)).toBeGreaterThan(0);
    expect(countSolutions(board, 3)).toBe(3);
  });

  test('is zero for an unsolvable board', () => {
    const blockers: Cell[] = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (!(r === 0 && c === 0) && !(r === 5 && c === 5)) blockers.push({ r, c });
    expect(countSolutions(new Board(blockers))).toBe(0);
  });
});

describe('hint', () => {
  test('returns one legal placement for an unplaced piece that leads to a solution', () => {
    const board = fullBoardFrom(100);
    const h = hint(board);
    expect(h).not.toBeNull();
    expect(board.placements.has(h!.id)).toBe(false);
    expect(board.canPlace(h!.cells, h!.at)).toBe(true);
    board.place(h!.id, h!.cells, h!.at);
    expect(solve(board)).not.toBeNull();
  });

  test('is null on a solved board', () => {
    const board = fullBoardFrom(100);
    for (const [id, p] of solve(board)!) board.place(id, p.cells, p.at);
    expect(hint(board)).toBeNull();
  });
});
