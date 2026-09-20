import { describe, expect, test } from 'vitest';
import { DICE, PUZZLE_COUNT, parseSquare, squareName, roll, rollFromSeed } from './dice';

describe('DICE', () => {
  test('matches the physical game exactly', () => {
    expect(DICE).toEqual([
      ['A1', 'C1', 'D1', 'D2', 'E2', 'F3'],
      ['A2', 'B2', 'C2', 'A3', 'B1', 'B3'],
      ['C3', 'D3', 'E3', 'B4', 'C4', 'D4'],
      ['E1', 'F2', 'F2', 'B6', 'A5', 'A5'],
      ['A4', 'B5', 'C6', 'C5', 'D6', 'F6'],
      ['E4', 'F4', 'E5', 'F5', 'D5', 'E6'],
      ['F1', 'F1', 'F1', 'A6', 'A6', 'A6'],
    ]);
  });

  test('the seven dice cover all 36 squares with no square on two dice', () => {
    const squares = new Set(DICE.flat());
    expect(squares.size).toBe(36);
  });

  test('there are 62,208 distinct puzzles', () => {
    expect(PUZZLE_COUNT).toBe(62208);
  });
});

describe('square names', () => {
  test('letters are rows and numbers are columns, as printed on the board', () => {
    expect(parseSquare('A1')).toEqual({ r: 0, c: 0 });
    expect(parseSquare('F6')).toEqual({ r: 5, c: 5 });
    expect(parseSquare('C2')).toEqual({ r: 2, c: 1 });
    expect(parseSquare('A6')).toEqual({ r: 0, c: 5 });
  });

  test('squareName is the inverse of parseSquare', () => {
    expect(squareName({ r: 2, c: 1 })).toBe('C2');
    expect(squareName(parseSquare('E4'))).toBe('E4');
  });
});

describe('roll', () => {
  test('returns one face from each die, in die order', () => {
    const cells = roll();
    expect(cells).toHaveLength(7);
    cells.forEach((cell, i) => {
      expect(DICE[i]).toContain(squareName(cell));
    });
  });

  test('uses the supplied random source', () => {
    const first = roll(() => 0);
    const last = roll(() => 0.999999);
    expect(first.map(squareName)).toEqual(['A1', 'A2', 'C3', 'E1', 'A4', 'E4', 'F1']);
    expect(last.map(squareName)).toEqual(['F3', 'B3', 'D4', 'A5', 'F6', 'E6', 'A6']);
  });
});

describe('rollFromSeed', () => {
  test('is deterministic', () => {
    expect(rollFromSeed(12345)).toEqual(rollFromSeed(12345));
  });

  test('seed 0 is the first face of every die', () => {
    expect(rollFromSeed(0).map(squareName)).toEqual(['A1', 'A2', 'C3', 'E1', 'A4', 'E4', 'F1']);
  });

  test('every seed below PUZZLE_COUNT gives a distinct blocker set', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < PUZZLE_COUNT; seed++) {
      const key = rollFromSeed(seed).map(squareName).sort().join(' ');
      seen.add(key);
    }
    expect(seen.size).toBe(PUZZLE_COUNT);
  });

  test('rejects seeds outside the puzzle range', () => {
    expect(() => rollFromSeed(-1)).toThrow();
    expect(() => rollFromSeed(PUZZLE_COUNT)).toThrow();
    expect(() => rollFromSeed(1.5)).toThrow();
  });
});
