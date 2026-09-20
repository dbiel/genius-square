import { describe, expect, test } from 'vitest';
import { PIECES, orientationsOf, type Cell } from './pieces';

describe('PIECES', () => {
  test('there are 9 pieces covering 29 squares in total', () => {
    expect(PIECES).toHaveLength(9);
    const total = PIECES.reduce((sum, p) => sum + p.size, 0);
    expect(total).toBe(29);
  });

  test.each([
    ['dot', 1],
    ['domino', 2],
    ['bar3', 2],
    ['smallL', 4],
    ['bar4', 2],
    ['square', 1],
    ['t', 4],
    ['bigL', 8],
    ['s', 4],
  ])('%s has %i unique orientations', (id, count) => {
    const piece = PIECES.find((p) => p.id === id);
    expect(piece).toBeDefined();
    expect(piece!.orientations).toHaveLength(count);
  });

  test('every orientation has the piece size and is normalized to the origin', () => {
    for (const piece of PIECES) {
      for (const cells of piece.orientations) {
        expect(cells).toHaveLength(piece.size);
        expect(Math.min(...cells.map((c) => c.r))).toBe(0);
        expect(Math.min(...cells.map((c) => c.c))).toBe(0);
      }
    }
  });
});

describe('orientationsOf', () => {
  test('a single cell has one orientation', () => {
    expect(orientationsOf([{ r: 0, c: 0 }])).toEqual([[{ r: 0, c: 0 }]]);
  });

  test('a 1x2 domino has two orientations, horizontal and vertical', () => {
    const result = orientationsOf([{ r: 0, c: 0 }, { r: 0, c: 1 }]);
    expect(result).toHaveLength(2);
    const asKeys = result.map((cells: Cell[]) => cells.map((c) => `${c.r},${c.c}`).join(' '));
    expect(asKeys).toContain('0,0 0,1');
    expect(asKeys).toContain('0,0 1,0');
  });

  test('cells inside an orientation are sorted by row then column', () => {
    const result = orientationsOf([{ r: 1, c: 0 }, { r: 0, c: 0 }, { r: 0, c: 1 }]);
    for (const cells of result) {
      const sorted = [...cells].sort((a, b) => a.r - b.r || a.c - b.c);
      expect(cells).toEqual(sorted);
    }
  });
});
