import { describe, expect, test } from 'vitest';
import { LEVEL_COUNT, levelOf, randomSeedForLevel, seedsAtLevel } from './levels';
import { PUZZLE_COUNT } from './dice';

describe('levels', () => {
  test('there are 10 levels and every puzzle has one', () => {
    expect(LEVEL_COUNT).toBe(10);
    for (const seed of [0, 1, 12345, PUZZLE_COUNT - 1]) {
      expect(levelOf(seed)).toBeGreaterThanOrEqual(1);
      expect(levelOf(seed)).toBeLessThanOrEqual(LEVEL_COUNT);
    }
  });

  test('levels split the puzzles into roughly equal tenths', () => {
    let total = 0;
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const n = seedsAtLevel(level).length;
      expect(n).toBeGreaterThan(PUZZLE_COUNT / LEVEL_COUNT - 20);
      expect(n).toBeLessThan(PUZZLE_COUNT / LEVEL_COUNT + 20);
      total += n;
    }
    expect(total).toBe(PUZZLE_COUNT);
  });

  test('randomSeedForLevel returns a seed of that level using the given random source', () => {
    for (let level = 1; level <= LEVEL_COUNT; level++) {
      const seed = randomSeedForLevel(level, () => 0.37);
      expect(levelOf(seed)).toBe(level);
      expect(randomSeedForLevel(level, () => 0.37)).toBe(seed);
    }
  });

  test('rejects levels out of range', () => {
    expect(() => randomSeedForLevel(0)).toThrow();
    expect(() => randomSeedForLevel(11)).toThrow();
  });
});
